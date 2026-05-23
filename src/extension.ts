import * as vscode from "vscode";
import { configureMcp } from "./commands/configureMcp";
import { initializeProject } from "./commands/initializeProject";
import { runQuickAction } from "./commands/quickActions";
import { setupWorkspace, openPatchloomReleases, openPatchloomSettings } from "./commands/setupWorkspace";
import { showStatus } from "./commands/showStatus";
import { setManagedInstallRoot } from "./install/managed";
import { disposeStatusBar, refreshStatusBar } from "./status/statusBar";

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
