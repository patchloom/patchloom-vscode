import * as vscode from "vscode";
import { resolvePatchloomStatus } from "../binary/patchloom";

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
    statusBarItem.command = "patchloom.showStatus";
  }

  const status = await resolvePatchloomStatus();
  statusBarItem.text = status.ready ? "$(check) Patchloom" : "$(warning) Patchloom";
  statusBarItem.tooltip = [
    status.message,
    status.version ? `Version: ${status.version}` : undefined,
    status.binaryPath ? `Path: ${status.binaryPath}` : undefined
  ].filter((line): line is string => Boolean(line)).join("\n");
  statusBarItem.show();
}

export function disposeStatusBar(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
