import type * as VSCode from "vscode";
import { inspectMcpTargets } from "../mcp/config";

export interface WorkspaceReadiness {
  readonly workspaceName?: string;
  readonly hasWorkspace: boolean;
  readonly hasAgentsFile?: boolean;
  readonly hasMcpConfig?: boolean;
}

export async function inspectWorkspaceReadiness(): Promise<WorkspaceReadiness> {
  const vscode = await import("vscode");
  const folder = await activeWorkspaceFolder();
  if (!folder) {
    return {
      hasWorkspace: false,
      hasMcpConfig: (await inspectMcpTargets({})).some((target) => target.configured)
    };
  }

  const mcpTargets = await inspectMcpTargets({
    workspaceFolderPath: folder.uri.fsPath
  });

  return {
    workspaceName: folder.name,
    hasWorkspace: true,
    hasAgentsFile: await fileExists(vscode.Uri.joinPath(folder.uri, "AGENTS.md")),
    hasMcpConfig: mcpTargets.some((target) => target.configured)
  };
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

async function fileExists(uri: VSCode.Uri): Promise<boolean> {
  const vscode = await import("vscode");
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
