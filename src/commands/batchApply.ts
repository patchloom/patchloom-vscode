import { execFile } from "node:child_process";
import type * as VSCode from "vscode";
import { patchloomNeedsUpgrade, resolvePatchloomStatus } from "../binary/patchloom.js";
import { formatCliOutput } from "../util.js";
import { getPatchloomLog } from "../logging/outputChannel.js";
import { activeWorkspaceFolder } from "../workspace/readiness.js";

export const BATCH_TEMPLATE = [
  "replace src/example.ts \"old text\" \"new text\"",
  "doc.set package.json version \"2.0.0\"",
  "file.append src/example.ts \"new appended line\"",
  "tidy.fix src/example.ts",
  ""
].join("\n");

export function buildBatchTemplate(): string {
  return BATCH_TEMPLATE;
}

export function parseBatchOperationCount(plan: string): number {
  return plan.split("\n").filter((line) => line.trim().length > 0).length;
}

export async function batchApply(): Promise<void> {
  const vscode: typeof VSCode = await import("vscode");
  const status = await resolvePatchloomStatus();
  if (!status.ready || !status.binaryPath) {
    const choice = await vscode.window.showWarningMessage(status.message, "Open Settings");
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand("patchloom.openPatchloomSettings");
    }
    return;
  }

  if (patchloomNeedsUpgrade(status)) {
    const choice = await vscode.window.showWarningMessage(
      `${status.compatibilityMessage}\n\nUpgrade Patchloom before running batch operations.`,
      "Open Releases"
    );
    if (choice === "Open Releases") {
      await vscode.commands.executeCommand("patchloom.openPatchloomReleases");
    }
    return;
  }

  const folder = await activeWorkspaceFolder({
    promptIfMany: true,
    placeHolder: "Select workspace folder for batch apply"
  });
  if (!folder) {
    await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom: Batch Apply.");
    return;
  }

  const binaryPath = status.binaryPath;
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
  const args = ["batch", "--apply"];
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

