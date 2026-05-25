import * as vscode from "vscode";
import { configureMcp } from "./commands/configureMcp.js";
import { initializeProject } from "./commands/initializeProject.js";
import { runQuickAction } from "./commands/quickActions.js";
import { setupWorkspace, openPatchloomReleases, openPatchloomSettings } from "./commands/setupWorkspace.js";
import { showStatus } from "./commands/showStatus.js";
import { setManagedInstallRoot } from "./install/managed.js";
import { disposeStatusBar, refreshStatusBar } from "./status/statusBar.js";

export function activate(context: vscode.ExtensionContext): void {
  setManagedInstallRoot(context.globalStorageUri.fsPath);
  context.subscriptions.push(
    vscode.commands.registerCommand("patchloom.initializeProject", initializeProject),
    vscode.commands.registerCommand("patchloom.setupWorkspace", setupWorkspace),
    vscode.commands.registerCommand("patchloom.configureMcp", configureMcp),
    vscode.commands.registerCommand("patchloom.quickAction", runQuickAction),
    vscode.commands.registerCommand("patchloom.openPatchloomSettings", openPatchloomSettings),
    vscode.commands.registerCommand("patchloom.openPatchloomReleases", openPatchloomReleases),
    vscode.commands.registerCommand("patchloom.showStatus", showStatus),
    new vscode.Disposable(disposeStatusBar),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("patchloom")) {
        void refreshStatusBar();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refreshStatusBar();
    })
  );

  void refreshStatusBar();
}

export function deactivate(): void {
  setManagedInstallRoot(undefined);
  disposeStatusBar();
}
