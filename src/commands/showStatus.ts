import {
  describePatchloomCompatibility,
  describePatchloomSource,
  patchloomNeedsUpgrade,
  PatchloomStatus,
  resolvePatchloomStatus
} from "../binary/patchloom";
import { inspectWorkspaceReadiness, WorkspaceReadiness } from "../workspace/readiness";

export interface SetupAction {
  readonly title: string;
  readonly command: string;
}

export async function showStatus(): Promise<void> {
  const vscode = await import("vscode");
  const status = await resolvePatchloomStatus();
  const workspaceReadiness = await inspectWorkspaceReadiness({
    promptIfMany: true,
    placeHolder: "Select the workspace folder to inspect for Patchloom status"
  });
  const details = buildStatusDetails(status, workspaceReadiness);
  const action = preferredStatusAction(status, workspaceReadiness);

  if (!action) {
    await vscode.window.showInformationMessage(details);
    return;
  }

  const messageFn = (!status.ready || patchloomNeedsUpgrade(status))
    ? vscode.window.showWarningMessage
    : vscode.window.showInformationMessage;
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
    status.detectedVersion ? `Detected CLI version: ${status.detectedVersion}` : undefined,
    status.minimumSupportedVersion ? `Required CLI version: >= ${status.minimumSupportedVersion}` : undefined,
    status.compatibility ? `CLI compatibility: ${describePatchloomCompatibility(status.compatibility)}` : undefined,
    status.compatibilityMessage && patchloomNeedsUpgrade(status) ? status.compatibilityMessage : undefined,
    status.binaryPath ? `Path: ${status.binaryPath}` : undefined,
    status.managedInstall?.version ? `Managed install version: ${status.managedInstall.version}` : undefined,
    status.managedInstall ? `Managed install: ${status.managedInstall.exists ? "available" : "not installed"}` : undefined,
    status.managedInstall?.target ? `Managed target: ${status.managedInstall.target.targetTriple}` : undefined,
    workspaceReadiness?.workspaceName ? `Workspace: ${workspaceReadiness.workspaceName}` : undefined,
    workspaceReadiness?.hasWorkspace === false
      ? "Workspace: no folder open"
      : undefined,
    `Environment: ${workspaceReadiness?.environmentLabel ?? "Local"}`,
    workspaceReadiness?.environmentSupport ? `Environment support: ${workspaceReadiness.environmentSupport}` : undefined,
    workspaceReadiness?.environmentNote,
    workspaceReadiness && workspaceReadiness.workspaceCount > 1 ? `Workspace folders: ${workspaceReadiness.workspaceCount}` : undefined,
    workspaceReadiness?.hasAgentsFile === undefined
      ? undefined
      : `AGENTS.md: ${workspaceReadiness.hasAgentsFile ? "present" : "missing"}`,
    workspaceReadiness?.hasMcpConfig === undefined
      ? undefined
      : `MCP config: ${workspaceReadiness.hasMcpConfig ? "present" : "missing"}`
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function preferredStatusAction(status: PatchloomStatus, workspaceReadiness?: WorkspaceReadiness): SetupAction | undefined {
  if (!status.ready) {
    return {
      title: "Open Settings",
      command: "patchloom.openPatchloomSettings"
    };
  }

  if (patchloomNeedsUpgrade(status)) {
    return {
      title: "Open Releases",
      command: "patchloom.openPatchloomReleases"
    };
  }

  if (workspaceReadiness?.hasWorkspace && workspaceReadiness.hasAgentsFile === false) {
    return {
      title: "Initialize Project",
      command: "patchloom.initializeProject"
    };
  }

  if (workspaceReadiness?.hasMcpConfig === false) {
    return {
      title: "Configure MCP",
      command: "patchloom.configureMcp"
    };
  }

  return undefined;
}
