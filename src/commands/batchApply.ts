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
// doc.update / doc.delete_where are the multi-match siblings of doc.set / doc.delete
// (CLI 0.27+ suggested_op hints this).
export const BATCH_TEMPLATE = [
  "replace src/example.ts \"old text\" \"new text\"",
  "replace src/example.ts \"typo_here\" \"fixed\" --fuzzy --min-fuzzy-score 0.80",
  "replace src/example.ts \"anchor_line\" --insert-after=\"new sibling line\"",
  "doc.set package.json version \"2.0.0\"",
  "doc.update data.json \"items[*].enabled\" true",
  "doc.delete_where data.json items name=stale",
  "doc.merge multi-doc.yaml 0 \"{\\\"debug\\\": true}\"",
  "file.append src/example.ts \"new appended line\"",
  "md.insert_after_section README.md \"## Config\" \"## FAQ\"",
  "tidy.fix src/example.ts",
  ""
].join("\n");

export function buildBatchTemplate(): string {
  return BATCH_TEMPLATE;
}

export const BATCH_APPLY_PROMPT =
  "Edit the batch plan, then click Apply to execute all operations atomically. Multi-match lines use dotted batch ops: doc.update PATH SELECTOR VALUE and doc.delete_where PATH SELECTOR PREDICATE.";

export function parseBatchOperationCount(plan: string): number {
  return plan.split("\n").filter((line) => line.trim().length > 0).length;
}

/** True when the plan has no non-empty operation lines. */
export function isEmptyBatchPlan(plan: string): boolean {
  return parseBatchOperationCount(plan) === 0;
}

/** CLI argv for Batch Apply. Flags come from serializePatchloomArgs, not from scanning operands. */
export function buildBatchApplyArgs(): string[] {
  return serializePatchloomArgs({ args: ["batch"], apply: true, contain: true });
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
  presentCliResultInOutput(log, result);
  await vscode.window.showInformationMessage(
    `Batch apply completed: ${ops} operation(s) applied.`
  );
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

