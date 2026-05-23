import type * as VSCode from "vscode";
import { describePatchloomSource, PatchloomStatus, resolvePatchloomStatus } from "../binary/patchloom";
import { activeWorkspaceFolder } from "./initializeProject";

export interface StatusWorkspaceContext {
  readonly workspaceName?: string;
  readonly hasAgentsFile?: boolean;
}

export async function showStatus(): Promise<void> {
  const vscode = await import("vscode");
  const status = await resolvePatchloomStatus();
  const workspaceContext = await inspectStatusWorkspaceContext();
  const details = buildStatusDetails(status, workspaceContext);

  if (!status.ready) {
    const choice = await vscode.window.showWarningMessage(details, "Open Settings");
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand("workbench.action.openSettings", "patchloom.path");
    }
    return;
  }

  if (workspaceContext?.hasAgentsFile === false) {
    const choice = await vscode.window.showInformationMessage(details, "Initialize Project");
    if (choice === "Initialize Project") {
      await vscode.commands.executeCommand("patchloom.initializeProject");
    }
    return;
  }

  await vscode.window.showInformationMessage(details);
}

export function buildStatusDetails(status: PatchloomStatus, workspaceContext?: StatusWorkspaceContext): string {
  return [
    status.ready ? "Patchloom is ready." : "Patchloom is not ready.",
    status.message,
    `Source: ${describePatchloomSource(status.source)}`,
    status.version ? `Version: ${status.version}` : undefined,
    status.binaryPath ? `Path: ${status.binaryPath}` : undefined,
    workspaceContext?.workspaceName ? `Workspace: ${workspaceContext.workspaceName}` : undefined,
    workspaceContext?.hasAgentsFile === undefined
      ? undefined
      : `AGENTS.md: ${workspaceContext.hasAgentsFile ? "present" : "missing"}`
  ].filter((line): line is string => Boolean(line)).join("\n");
}

async function inspectStatusWorkspaceContext(): Promise<StatusWorkspaceContext | undefined> {
  const vscode = await import("vscode");
  const folder = await activeWorkspaceFolder();
  if (!folder) {
    return undefined;
  }

  return {
    workspaceName: folder.name,
    hasAgentsFile: await fileExists(vscode.Uri.joinPath(folder.uri, "AGENTS.md"))
  };
}

async function fileExists(uri: VSCode.Uri): Promise<boolean> {
  const vscode = await import("vscode");
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
