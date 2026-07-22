import { execFile } from "node:child_process";
import type * as VSCode from "vscode";
import { ensurePatchloomReadyOrNotify } from "../binary/patchloom.js";
import { formatCliOutput } from "../util.js";
import { getPatchloomLog } from "../logging/outputChannel.js";
import { activeWorkspaceFolder } from "../workspace/readiness.js";

export const BATCH_TEMPLATE = [
  "replace src/example.ts \"old text\" \"new text\"",
  "replace src/example.ts \"typo_here\" \"fixed\" --fuzzy --min-fuzzy-score 0.80",
  "doc.set package.json version \"2.0.0\"",
  "doc.merge multi-doc.yaml 0 \"{\\\"debug\\\": true}\"",
  "file.append src/example.ts \"new appended line\"",
  "md.insert_after_section README.md \"## Config\" \"## FAQ\"",
  "tidy.fix src/example.ts",
  ""
].join("\n");

export function buildBatchTemplate(): string {
  return BATCH_TEMPLATE;
}

export function parseBatchOperationCount(plan: string): number {
  return plan.split("\n").filter((line) => line.trim().length > 0).length;
}

/** CLI argv for Batch Apply. Global --contain first (CLI 0.10+ path guard). */
export function buildBatchApplyArgs(): string[] {
  return ["--contain", "batch", "--apply"];
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
    "Edit the batch plan, then click Apply to execute all operations atomically.",
    "Apply"
  );
  if (choice !== "Apply") {
    return;
  }

  const plan = doc.getText();
  const log = getPatchloomLog();
  const args = buildBatchApplyArgs();
  log?.logCommand(binaryPath, args, folder.uri.fsPath);

  const result = await executePatchloomWithStdin(binaryPath, args, folder.uri.fsPath, plan);
  log?.logResult(result.exitCode, result.stdout, result.stderr);

  if (result.exitCode !== 0) {
    log?.show();
    await vscode.window.showErrorMessage(
      `Batch apply failed: ${formatCliOutput(result)}`
    );
    return;
  }

  const ops = parseBatchOperationCount(plan);
  log?.show();
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
  stdin: string
): Promise<BatchCommandResult> {
  return new Promise((resolve) => {
    const child = execFile(binaryPath, [...args], {
      cwd,
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

