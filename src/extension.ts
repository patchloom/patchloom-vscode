import * as vscode from "vscode";
import { initializeProject } from "./commands/initializeProject";
import { showStatus } from "./commands/showStatus";
import { disposeStatusBar, refreshStatusBar } from "./status/statusBar";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("patchloom.initializeProject", initializeProject),
    vscode.commands.registerCommand("patchloom.showStatus", showStatus),
    new vscode.Disposable(disposeStatusBar),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("patchloom")) {
        void refreshStatusBar();
      }
    })
  );

  void refreshStatusBar();
}

export function deactivate(): void {
  disposeStatusBar();
}
