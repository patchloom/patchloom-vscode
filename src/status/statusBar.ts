import * as vscode from "vscode";
import { patchloomNeedsUpgrade, resolvePatchloomStatus } from "../binary/patchloom.js";
import { buildStatusDetails, preferredStatusAction } from "./details.js";
import { inspectWorkspaceReadiness } from "../workspace/readiness.js";

let statusBarItem: vscode.StatusBarItem | undefined;

export async function refreshStatusBar(): Promise<void> {
  const enabled = vscode.workspace.getConfiguration("patchloom").get<boolean>("showStatusBar", true);
  if (!enabled) {
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

  statusBarItem.text = !status.ready || patchloomNeedsUpgrade(status)
    ? "$(warning) Patchloom"
    : workspaceReadiness?.hasMcpConfig
      ? "$(plug) Patchloom MCP"
      : "$(check) Patchloom";
  statusBarItem.command = action?.command ?? "patchloom.showStatus";
  statusBarItem.tooltip = buildStatusDetails(status, workspaceReadiness);
  statusBarItem.show();
}

export function disposeStatusBar(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
