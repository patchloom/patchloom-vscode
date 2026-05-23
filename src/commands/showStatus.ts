import { describePatchloomSource, PatchloomStatus, resolvePatchloomStatus } from "../binary/patchloom";
import { inspectWorkspaceReadiness, WorkspaceReadiness } from "../workspace/readiness";

export interface SetupAction {
  readonly title: string;
  readonly command: string;
}

export async function showStatus(): Promise<void> {
  const vscode = await import("vscode");
  const status = await resolvePatchloomStatus();
  const workspaceReadiness = await inspectWorkspaceReadiness();
  const details = buildStatusDetails(status, workspaceReadiness);
  const action = preferredStatusAction(status, workspaceReadiness);

  if (!action) {
    await vscode.window.showInformationMessage(details);
    return;
  }

  const messageFn = status.ready ? vscode.window.showInformationMessage : vscode.window.showWarningMessage;
  const choice = await messageFn(details, action.title);
  if (choice === action.title) {
    await vscode.commands.executeCommand(action.command);
  }
}

export function buildStatusDetails(status: PatchloomStatus, workspaceReadiness?: WorkspaceReadiness): string {
  return [
    status.ready ? "Patchloom is ready." : "Patchloom is not ready.",
    status.message,
    `Source: ${describePatchloomSource(status.source)}`,
    status.version ? `Version: ${status.version}` : undefined,
    status.binaryPath ? `Path: ${status.binaryPath}` : undefined,
    workspaceReadiness?.workspaceName ? `Workspace: ${workspaceReadiness.workspaceName}` : undefined,
    workspaceReadiness?.hasWorkspace === false
      ? "Workspace: no folder open"
      : undefined,
    workspaceReadiness?.hasAgentsFile === undefined
      ? undefined
      : `AGENTS.md: ${workspaceReadiness.hasAgentsFile ? "present" : "missing"}`
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function preferredStatusAction(status: PatchloomStatus, workspaceReadiness?: WorkspaceReadiness): SetupAction | undefined {
  if (!status.ready) {
    return {
      title: "Open Settings",
      command: "patchloom.openPatchloomSettings"
    };
  }

  if (workspaceReadiness?.hasWorkspace && workspaceReadiness.hasAgentsFile === false) {
    return {
      title: "Initialize Project",
      command: "patchloom.initializeProject"
    };
  }

  return undefined;
}
