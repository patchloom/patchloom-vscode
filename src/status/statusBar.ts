import * as vscode from "vscode";
import { patchloomNeedsUpgrade, resolvePatchloomStatus } from "../binary/patchloom.js";
import { buildStatusDetails, preferredStatusAction } from "./details.js";
import { inspectWorkspaceReadiness } from "../workspace/readiness.js";

let statusBarItem: vscode.StatusBarItem | undefined;

export async function refreshStatusBar(): Promise<void> {
  const config = vscode.workspace.getConfiguration("patchloom");
  const extensionEnabled = config.get<boolean>("enable", true);
  const statusBarEnabled = config.get<boolean>("showStatusBar", true);
  if (!extensionEnabled || !statusBarEnabled) {
    statusBarItem?.hide();
    return;
  }

  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.name = "Patchloom Status";
  }

  const status = await resolvePatchloomStatus();
  const workspaceReadiness = await inspectWorkspaceReadiness();
  const action = preferredStatusAction(status, workspaceReadiness);

  void vscode.commands.executeCommand("setContext", "patchloom.cliAvailable", status.ready);
  void vscode.commands.executeCommand("setContext", "patchloom.managedInstallExists", status.managedInstall?.exists === true);
  void vscode.commands.executeCommand("setContext", "patchloom.projectInitialized", workspaceReadiness?.hasAgentsFile === true);

  const versionSuffix = status.detectedVersion ? ` v${status.detectedVersion}` : "";
  statusBarItem.text = !status.ready || patchloomNeedsUpgrade(status)
    ? "$(warning) Patchloom"
    : workspaceReadiness?.hasMcpConfig
      ? `$(plug) Patchloom${versionSuffix}`
      : `$(check) Patchloom${versionSuffix}`;
  statusBarItem.command = action?.command ?? "patchloom.showStatus";
  statusBarItem.tooltip = buildStatusDetails(status, workspaceReadiness);
  statusBarItem.show();
}

export function disposeStatusBar(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
