import {
  describePatchloomCompatibility,
  describePatchloomSource,
  patchloomNeedsUpgrade,
  PatchloomStatus
} from "../binary/patchloom.js";
import type { McpTargetStatus } from "../mcp/config.js";
import { WorkspaceReadiness } from "../workspace/readiness.js";

export interface SetupAction {
  readonly title: string;
  readonly command: string;
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
    status.managedInstall ? `Managed install: ${status.managedInstall.exists ? "available" : "not installed"}` : undefined,
    status.managedInstall?.target ? `Managed target: ${status.managedInstall.target.targetTriple}` : undefined,
    status.managedInstall?.failure ? `Managed install last failure: ${status.managedInstall.failure.stage} (${status.managedInstall.failure.reason})` : undefined,
    ...(status.diagnostics ?? []),
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
    ...formatMcpTargetDetails(workspaceReadiness?.mcpTargets)
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export function preferredStatusAction(status: PatchloomStatus, workspaceReadiness?: WorkspaceReadiness): SetupAction | undefined {
  if (!status.ready) {
    if (status.source === "missing" && status.managedInstall && !status.managedInstall.exists) {
      return {
        title: "Install Patchloom",
        command: "patchloom.installBinary"
      };
    }
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

function formatMcpTargetDetails(targets?: readonly McpTargetStatus[]): string[] {
  if (!targets || targets.length === 0) {
    return ["MCP config: no targets available"];
  }

  return targets.map((target) => {
    const icon = target.configured ? "\u2713" : "\u2717";
    return `MCP ${target.label}: ${icon} ${target.configured ? "configured" : "not configured"}`;
  });
}