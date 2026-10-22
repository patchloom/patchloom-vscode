import * as vscode from "vscode";
import { patchloomNeedsUpgrade, resolvePatchloomStatus } from "../binary/patchloom.js";
import { decideStatusPresentation } from "./contextKeys.js";
import { buildStatusDetails } from "./details.js";
import { inspectWorkspaceReadiness } from "../workspace/readiness.js";

let statusBarItem: vscode.StatusBarItem | undefined;

export async function refreshStatusBar(): Promise<void> {
  const config = vscode.workspace.getConfiguration("patchloom");
  const status = await resolvePatchloomStatus();
  const workspaceReadiness = await inspectWorkspaceReadiness();
  const presentation = decideStatusPresentation({
    extensionEnabled: config.get<boolean>("enable", true),
    statusBarEnabled: config.get<boolean>("showStatusBar", true),
    cliReady: status.ready,
    managedInstallExists: status.managedInstall?.exists === true,
    projectInitialized: workspaceReadiness?.hasAgentsFile === true
  });

  void vscode.commands.executeCommand("setContext", "patchloom.cliAvailable", presentation.context.cliAvailable);
  void vscode.commands.executeCommand("setContext", "patchloom.managedInstallExists", presentation.context.managedInstallExists);
  void vscode.commands.executeCommand("setContext", "patchloom.projectInitialized", presentation.context.projectInitialized);

  if (!presentation.showStatusBar) {
    statusBarItem?.hide();
    return;
  }

  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.name = "Patchloom Status";
  }

  const versionSuffix = status.detectedVersion ? ` v${status.detectedVersion}` : "";
  statusBarItem.text = !status.ready || patchloomNeedsUpgrade(status)
    ? "$(warning) Patchloom"
    : workspaceReadiness?.hasMcpConfig
      ? `$(plug) Patchloom${versionSuffix}`
      : `$(check) Patchloom${versionSuffix}`;
  statusBarItem.command = presentation.statusBarCommand;
  statusBarItem.tooltip = buildStatusDetails(status, workspaceReadiness);
  statusBarItem.show();
}

export function disposeStatusBar(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
