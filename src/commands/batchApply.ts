import { execFile } from "node:child_process";
import type * as VSCode from "vscode";
import { ensurePatchloomReadyOrNotify } from "../binary/patchloom.js";
import { formatCliOutput, mergePatchloomEnv } from "../util.js";
import {
  getPatchloomLog,
  getPatchloomRuntimeConfig,
  logCliCommand,
  logCliResult,
  presentCliResultInOutput
} from "../logging/outputChannel.js";
import { activeWorkspaceFolder } from "../workspace/readiness.js";
import { serializePatchloomArgs } from "./quickActions.js";

// Batch replace is PATH OLD NEW (not CLI `replace OLD --new NEW path`). See CLI 0.18+ batch --help.
// --insert-after is not a batch flag. The CLI stores that token as the new text.
// doc.update / doc.delete_where are the multi-match siblings of doc.set / doc.delete
// (CLI 0.27+ suggested_op hints this).
export const BATCH_TEMPLATE = [
  "replace src/example.ts \"old text\" \"new text\"",
  "replace src/example.ts \"typo_here\" \"fixed\" --fuzzy --min-fuzzy-score 0.80",
  "file.prepend src/example.ts \"header line\"",
  "doc.set package.json version \"2.0.0\"",
  "doc.set tsconfig.jsonc compilerOptions.strict true",
  "doc.update data.json \"items[*].enabled\" true",
  "doc.delete_where data.json items name=stale",
  "doc.merge multi-doc.yaml 0 \"{\\\"debug\\\": true}\"",
  "file.append src/example.ts \"new appended line\"",
  "file.rename src/old_pkg src/new_pkg",
  "md.insert_after_section README.md \"## Config\" \"## FAQ\"",
  "tidy.fix src/example.ts",
  ""
].join("\n");

export function buildBatchTemplate(): string {
  return BATCH_TEMPLATE;
}

export const BATCH_APPLY_PROMPT =
  "Edit the batch plan, then click Apply. A hard error rolls the plan back. A replace that matches nothing, or a structured delete that removes nothing, is reported and does not undo other writes. Lines whose first non-whitespace character is # are comments and are not applied. Multi-match lines use dotted batch ops: doc.update PATH SELECTOR VALUE and doc.delete_where PATH SELECTOR PREDICATE.";

/** Count operations `patchloom batch` will run. A leading BOM, blank lines, and `#` comments are ignored. */
export function parseBatchOperationCount(plan: string): number {
  const body = plan.charCodeAt(0) === 0xfeff ? plan.slice(1) : plan;
  return body.split("\n").filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("#");
  }).length;
}

/** True when the plan has no non-empty operation lines. */
export function isEmptyBatchPlan(plan: string): boolean {
  return parseBatchOperationCount(plan) === 0;
}

/** CLI argv for Batch Apply. `--json` is how a refused replace is visible on exit 0. */
export function buildBatchApplyArgs(): string[] {
  return serializePatchloomArgs({ args: ["batch", "--json"], apply: true, contain: true });
}

export interface BatchRefusedOperation {
  readonly path: string;
  readonly reason: string;
}

export interface BatchUnchangedMutation {
  readonly path: string;
  readonly op: string;
}

export interface BatchApplyReport {
  readonly filesChanged: number;
  readonly filesCreated: number;
  readonly filesDeleted: number;
  readonly filesRenamed: number;
  readonly matchCount: number | undefined;
  readonly refused: readonly BatchRefusedOperation[];
  readonly unchanged: readonly BatchUnchangedMutation[];
}

/** Parse `patchloom batch --json` stdout. Undefined when the CLI did not return that object. */
export function parseBatchApplyReport(stdout: string): BatchApplyReport | undefined {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      files_changed?: unknown;
      files_created?: unknown;
      files_deleted?: unknown;
      files_renamed?: unknown;
      match_count?: unknown;
      refused?: unknown;
      mutations?: unknown;
    };
    if (typeof parsed.files_changed !== "number") {
      return undefined;
    }
    const refused: BatchRefusedOperation[] = [];
    if (Array.isArray(parsed.refused)) {
      for (const item of parsed.refused) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const record = item as { path?: unknown; reason?: unknown };
        if (typeof record.path !== "string" || record.path.length === 0) {
          continue;
        }
        refused.push({
          path: record.path,
          reason: typeof record.reason === "string" && record.reason.length > 0 ? record.reason : "refused"
        });
      }
    }
    return {
      filesChanged: parsed.files_changed,
      filesCreated: typeof parsed.files_created === "number" ? parsed.files_created : 0,
      filesDeleted: typeof parsed.files_deleted === "number" ? parsed.files_deleted : 0,
      filesRenamed: typeof parsed.files_renamed === "number" ? parsed.files_renamed : 0,
      matchCount: typeof parsed.match_count === "number" ? parsed.match_count : undefined,
      refused,
      unchanged: unchangedMutations(parsed.mutations)
    };
  } catch {
    return undefined;
  }
}

export interface BatchApplyCompletion {
  readonly warning: boolean;
  readonly message: string;
}

/**
 * Exit 0 is not "every plan line was applied". CLI 0.37 keeps earlier writes
 * when another replace matches nothing (`refused` or `match_count: 0`) or
 * when `doc.delete` removes nothing (`mutations[].changed === false`).
 * A rename-only plan has `files_changed: 0` and `files_renamed: 1`.
 */
export function formatBatchApplyCompletion(stdout: string, operationCount: number): BatchApplyCompletion {
  const report = parseBatchApplyReport(stdout);
  if (!report) {
    return {
      warning: false,
      message: `Batch apply completed: ${operationCount} operation(s) applied.`
    };
  }

  const tally = describeBatchFileTally(report);
  const missed = [
    ...report.refused.map((item) => `${item.path} (${describeRefusedReason(item.reason)})`),
    ...report.unchanged.map((item) => `${item.path} (${item.op} changed nothing)`)
  ];
  if (missed.length > 0) {
    return {
      warning: true,
      message: `Batch apply: ${tally}. ${missed.length} operation(s) were not applied: ${missed.join(", ")}.`
    };
  }
  if (report.matchCount === 0) {
    return {
      warning: true,
      message: `Batch apply: ${tally}. A replace in the plan matched nothing.`
    };
  }
  return {
    warning: false,
    message: `Batch apply completed: ${tally}.`
  };
}

function describeBatchFileTally(report: BatchApplyReport): string {
  const parts: string[] = [];
  if (report.filesChanged > 0) {
    parts.push(`${report.filesChanged} file(s) changed`);
  }
  if (report.filesCreated > 0) {
    parts.push(`${report.filesCreated} file(s) created`);
  }
  if (report.filesDeleted > 0) {
    parts.push(`${report.filesDeleted} file(s) deleted`);
  }
  if (report.filesRenamed > 0) {
    parts.push(`${report.filesRenamed} file(s) renamed`);
  }
  return parts.length > 0 ? parts.join(", ") : "no files changed";
}

function unchangedMutations(value: unknown): BatchUnchangedMutation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unchanged: BatchUnchangedMutation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as { path?: unknown; op?: unknown; changed?: unknown };
    if (record.changed !== false || typeof record.path !== "string" || record.path.length === 0) {
      continue;
    }
    unchanged.push({
      path: record.path,
      op: typeof record.op === "string" && record.op.length > 0 ? record.op : "operation"
    });
  }
  return unchanged;
}

function describeRefusedReason(reason: string): string {
  if (reason === "no_matches") {
    return "no matches";
  }
  return reason.replaceAll("_", " ");
}

export async function batchApply(): Promise<void> {
  const binaryPath = await ensurePatchloomReadyOrNotify("Upgrade Patchloom before running batch operations.");
  if (!binaryPath) {
    return;
  }

  const vscode: typeof VSCode = await import("vscode");
  const folder = await activeWorkspaceFolder({
    promptIfMany: true,
    placeHolder: "Select workspace folder for batch apply"
  });
  if (!folder) {
    await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom: Batch Apply.");
    return;
  }

  const doc = await vscode.workspace.openTextDocument({
    language: "plaintext",
    content: BATCH_TEMPLATE
  });
  await vscode.window.showTextDocument(doc, { preview: false });

  const choice = await vscode.window.showInformationMessage(
    BATCH_APPLY_PROMPT,
    "Apply"
  );
  if (choice !== "Apply") {
    return;
  }

  const plan = doc.getText();
  if (isEmptyBatchPlan(plan)) {
    await vscode.window.showWarningMessage(
      "Batch plan is empty. Add at least one operation."
    );
    return;
  }

  const log = getPatchloomLog();
  const runtime = await getPatchloomRuntimeConfig();
  const env = mergePatchloomEnv(process.env, runtime.extraEnv);
  const args = buildBatchApplyArgs();
  logCliCommand(log, runtime.trace, binaryPath, args, folder.uri.fsPath);

  const result = await executePatchloomWithStdin(binaryPath, args, folder.uri.fsPath, plan, env);
  logCliResult(log, runtime.trace, result.exitCode, result.stdout, result.stderr);

  if (result.exitCode !== 0) {
    presentCliResultInOutput(log, result);
    await vscode.window.showErrorMessage(
      `Batch apply failed: ${formatCliOutput(result)}`
    );
    return;
  }

  const ops = parseBatchOperationCount(plan);
  const completion = formatBatchApplyCompletion(result.stdout, ops);
  presentCliResultInOutput(log, result);
  if (completion.warning) {
    await vscode.window.showWarningMessage(completion.message);
    return;
  }
  await vscode.window.showInformationMessage(completion.message);
}

interface BatchCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function executePatchloomWithStdin(
  binaryPath: string,
  args: readonly string[],
  cwd: string,
  stdin: string,
  env: NodeJS.ProcessEnv
): Promise<BatchCommandResult> {
  return new Promise((resolve) => {
    const child = execFile(binaryPath, [...args], {
      cwd,
      env,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        resolve({
          exitCode: typeof error.code === "number" ? error.code : 1,
          stdout,
          stderr: stderr || error.message
        });
      } else {
        resolve({ exitCode: 0, stdout, stderr });
      }
    });

    if (child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

