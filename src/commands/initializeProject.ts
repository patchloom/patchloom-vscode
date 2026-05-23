import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type * as VSCode from "vscode";
import { resolvePatchloomStatus } from "../binary/patchloom";

const execFileAsync = promisify(execFile);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type AgentsFileState = "missing" | "up_to_date" | "different";

export async function initializeProject(): Promise<void> {
  const vscode = await import("vscode");
  const { refreshStatusBar } = await import("../status/statusBar");
  const folder = await activeWorkspaceFolder();
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
  const existingContent = await readTextFileIfExists(agentsUri);
  const state = classifyAgentsFile(existingContent, rules);

  if (state === "missing") {
    await vscode.workspace.fs.writeFile(agentsUri, encoder.encode(rules));
    const doc = await vscode.workspace.openTextDocument(agentsUri);
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.window.showInformationMessage(`Created AGENTS.md in ${folder.name}.`);
    await refreshStatusBar();
    return;
  }

  if (state === "up_to_date") {
    const doc = await vscode.workspace.openTextDocument(agentsUri);
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.window.showInformationMessage(`AGENTS.md in ${folder.name} is already up to date.`);
    await refreshStatusBar();
    return;
  }

  const generatedDoc = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: rules
  });
  await vscode.commands.executeCommand(
    "vscode.diff",
    agentsUri,
    generatedDoc.uri,
    "AGENTS.md vs generated Patchloom rules"
  );
  await vscode.window.showWarningMessage("AGENTS.md already exists and differs. Opened a diff against newly generated rules.");
  await refreshStatusBar();
}

export async function activeWorkspaceFolder(): Promise<VSCode.WorkspaceFolder | undefined> {
  const vscode = await import("vscode");
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

export function classifyAgentsFile(existingContent: string | undefined, generatedRules: string): AgentsFileState {
  if (existingContent === undefined) {
    return "missing";
  }

  return normalizeForComparison(existingContent) === normalizeForComparison(generatedRules)
    ? "up_to_date"
    : "different";
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

async function readTextFileIfExists(uri: VSCode.Uri): Promise<string | undefined> {
  const vscode = await import("vscode");
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function normalizeForComparison(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd();
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}
