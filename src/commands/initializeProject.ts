import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import { resolvePatchloomStatus } from "../binary/patchloom";
import { refreshStatusBar } from "../status/statusBar";

const execFileAsync = promisify(execFile);
const encoder = new TextEncoder();

export async function initializeProject(): Promise<void> {
  const folder = activeWorkspaceFolder();
  if (!folder) {
    await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom: Initialize Project.");
    return;
  }

  const status = await resolvePatchloomStatus();
  if (!status.ready || !status.binaryPath) {
    const choice = await vscode.window.showWarningMessage(status.message, "Open Settings");
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "patchloom.path");
    }
    return;
  }

  let rules: string;
  try {
    rules = await generateAgentRules(status.binaryPath, folder.uri.fsPath);
  } catch (error) {
    await vscode.window.showErrorMessage(`Failed to run patchloom agent-rules: ${formatError(error)}`);
    return;
  }

  if (!rules.trim()) {
    await vscode.window.showErrorMessage("patchloom agent-rules returned no output.");
    return;
  }

  const agentsUri = vscode.Uri.joinPath(folder.uri, "AGENTS.md");
  const exists = await fileExists(agentsUri);

  if (exists) {
    const doc = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: rules
    });
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.window.showWarningMessage("AGENTS.md already exists. Opened generated rules in a new tab for manual merge.");
    return;
  }

  await vscode.workspace.fs.writeFile(agentsUri, encoder.encode(rules));
  const doc = await vscode.workspace.openTextDocument(agentsUri);
  await vscode.window.showTextDocument(doc, { preview: false });
  await vscode.window.showInformationMessage(`Created AGENTS.md in ${folder.name}.`);
  await refreshStatusBar();
}

function activeWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }

  const activeDocument = vscode.window.activeTextEditor?.document.uri;
  if (activeDocument) {
    return vscode.workspace.getWorkspaceFolder(activeDocument) ?? folders[0];
  }

  return folders[0];
}

async function generateAgentRules(binaryPath: string, cwd: string): Promise<string> {
  const { stdout } = await execFileAsync(binaryPath, ["agent-rules"], {
    cwd,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  return stdout.endsWith("\n") ? stdout : `${stdout}\n`;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}
