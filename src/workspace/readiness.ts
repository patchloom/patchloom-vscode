import type * as VSCode from "vscode";
import { inspectMcpTargets, type McpTargetStatus } from "../mcp/config.js";

export type WorkspaceEnvironmentSupport = "supported" | "limited" | "unverified";

export interface WorkspaceEnvironmentInfo {
  readonly remoteName?: string;
  readonly label: string;
  readonly support: WorkspaceEnvironmentSupport;
  readonly note?: string;
  readonly supportsUserMcpConfig: boolean;
}

export interface WorkspaceReadiness {
  readonly workspaceName?: string;
  readonly hasWorkspace: boolean;
  readonly hasAgentsFile?: boolean;
  readonly hasMcpConfig?: boolean;
  readonly mcpTargets?: readonly McpTargetStatus[];
  readonly workspaceCount: number;
  readonly environmentLabel: string;
  readonly environmentSupport: WorkspaceEnvironmentSupport;
  readonly environmentNote?: string;
}

export interface WorkspaceFolderSelectionOptions {
  readonly promptIfMany?: boolean;
  readonly placeHolder?: string;
}

export interface WorkspaceReadinessOptions extends WorkspaceFolderSelectionOptions {
  readonly folder?: VSCode.WorkspaceFolder;
}

export async function inspectWorkspaceReadiness(options: WorkspaceReadinessOptions = {}): Promise<WorkspaceReadiness> {
  const vscode = await import("vscode");
  const environment = describeWorkspaceEnvironment(vscode.env.remoteName);
  const folder = options.folder ?? await activeWorkspaceFolder({
    promptIfMany: options.promptIfMany,
    placeHolder: options.placeHolder
  });
  const workspaceCount = vscode.workspace.workspaceFolders?.length ?? 0;
  if (!folder) {
    const targets = await inspectMcpTargets({
      includeUserTarget: environment.supportsUserMcpConfig
    });
    return {
      hasWorkspace: false,
      hasMcpConfig: targets.some((target) => target.configured),
      mcpTargets: targets,
      workspaceCount,
      environmentLabel: environment.label,
      environmentSupport: environment.support,
      environmentNote: environment.note
    };
  }

  const targets = await inspectMcpTargets({
    workspaceFolderPath: folder.uri.fsPath,
    includeUserTarget: environment.supportsUserMcpConfig
  });

  return {
    workspaceName: folder.name,
    hasWorkspace: true,
    hasAgentsFile: await fileExists(vscode.Uri.joinPath(folder.uri, "AGENTS.md")),
    hasMcpConfig: targets.some((target) => target.configured),
    mcpTargets: targets,
    workspaceCount,
    environmentLabel: environment.label,
    environmentSupport: environment.support,
    environmentNote: environment.note
  };
}

export function describeWorkspaceEnvironment(remoteName?: string): WorkspaceEnvironmentInfo {
  switch (remoteName) {
    case undefined:
      return {
        label: "Local",
        support: "supported",
        supportsUserMcpConfig: true
      };
    case "wsl":
      return {
        remoteName,
        label: "WSL",
        support: "limited",
        note: "Workspace-scoped Patchloom commands are supported. User-scoped MCP config is only offered in local sessions.",
        supportsUserMcpConfig: false
      };
    case "ssh-remote":
      return {
        remoteName,
        label: "Remote SSH",
        support: "limited",
        note: "Workspace-scoped Patchloom commands are supported. User-scoped MCP config is only offered in local sessions.",
        supportsUserMcpConfig: false
      };
    case "dev-container":
      return {
        remoteName,
        label: "Dev Container",
        support: "limited",
        note: "Workspace-scoped Patchloom commands are supported. User-scoped MCP config is only offered in local sessions.",
        supportsUserMcpConfig: false
      };
    case "codespaces":
      return {
        remoteName,
        label: "Codespaces",
        support: "limited",
        note: "Workspace-scoped Patchloom commands are supported. User-scoped MCP config is only offered in local sessions.",
        supportsUserMcpConfig: false
      };
    default:
      return {
        remoteName,
        label: `Remote (${remoteName})`,
        support: "unverified",
        note: "Patchloom may work in this remote environment, but it is not explicitly verified yet. User-scoped MCP config is disabled.",
        supportsUserMcpConfig: false
      };
  }
}

export function defaultWorkspaceFolderIndex(workspaceCount: number, activeWorkspaceIndex?: number): number | undefined {
  if (activeWorkspaceIndex !== undefined && activeWorkspaceIndex >= 0 && activeWorkspaceIndex < workspaceCount) {
    return activeWorkspaceIndex;
  }
  if (workspaceCount === 1) {
    return 0;
  }
  return undefined;
}

export async function activeWorkspaceFolder(
  options: WorkspaceFolderSelectionOptions = {}
): Promise<VSCode.WorkspaceFolder | undefined> {
  const vscode = await import("vscode");
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }

  const activeDocument = vscode.window.activeTextEditor?.document.uri;
  const activeFolder = activeDocument ? vscode.workspace.getWorkspaceFolder(activeDocument) : undefined;
  const activeIndex = activeFolder
    ? folders.findIndex((folder) => folder.uri.toString() === activeFolder.uri.toString())
    : undefined;
  const selectedIndex = defaultWorkspaceFolderIndex(folders.length, activeIndex);
  if (selectedIndex !== undefined) {
    return folders[selectedIndex];
  }

  if (!options.promptIfMany) {
    return folders[0];
  }

  const selection = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder
    })),
    {
      placeHolder: options.placeHolder ?? "Select a workspace folder"
    }
  );
  return selection?.folder;
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
