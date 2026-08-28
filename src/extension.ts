import * as vscode from "vscode";
import { batchApply } from "./commands/batchApply.js";
import { configureMcp } from "./commands/configureMcp.js";
import { initializeProject } from "./commands/initializeProject.js";
import { installPatchloom, updatePatchloom, reinstallPatchloom } from "./commands/managedInstall.js";
import { runQuickAction } from "./commands/quickActions.js";
import { setupWorkspace, openPatchloomReleases, openPatchloomSettings, openDocumentation } from "./commands/setupWorkspace.js";
import { showStatus } from "./commands/showStatus.js";
import { verifyMcp } from "./commands/verifyMcp.js";
import { checkForUpdates } from "./commands/autoUpdate.js";
import { clearPatchloomStatusInflight } from "./binary/patchloom.js";
import { setManagedInstallRoot } from "./install/managed.js";
import { createPatchloomLog, getPatchloomLog, setPatchloomLog } from "./logging/outputChannel.js";
import { refreshMcpServerBinary, registerMcpServerProviderWithBinary } from "./mcp/register.js";
import { refreshAfterPatchloomInputChange } from "./status/refreshAfterInputChange.js";
import { disposeStatusBar, refreshStatusBar } from "./status/statusBar.js";

export function activate(context: vscode.ExtensionContext): void {
  setManagedInstallRoot(context.globalStorageUri.fsPath);

  const log = createPatchloomLog(() => vscode.window.createOutputChannel("Patchloom"));
  setPatchloomLog(log);

  context.subscriptions.push(
    vscode.commands.registerCommand("patchloom.initializeProject", initializeProject),
    vscode.commands.registerCommand("patchloom.setupWorkspace", setupWorkspace),
    vscode.commands.registerCommand("patchloom.configureMcp", configureMcp),
    vscode.commands.registerCommand("patchloom.quickAction", runQuickAction),
    vscode.commands.registerCommand("patchloom.batchApply", batchApply),
    vscode.commands.registerCommand("patchloom.showOutput", () => log.show()),
    vscode.commands.registerCommand("patchloom.openPatchloomSettings", openPatchloomSettings),
    vscode.commands.registerCommand("patchloom.openPatchloomReleases", openPatchloomReleases),
    vscode.commands.registerCommand("patchloom.showStatus", showStatus),
    vscode.commands.registerCommand("patchloom.installBinary", installPatchloom),
    vscode.commands.registerCommand("patchloom.updateBinary", updatePatchloom),
    vscode.commands.registerCommand("patchloom.reinstallBinary", reinstallPatchloom),
    vscode.commands.registerCommand("patchloom.verifyMcp", verifyMcp),
    vscode.commands.registerCommand("patchloom.openDocumentation", openDocumentation),
    new vscode.Disposable(disposeStatusBar),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("patchloom")) {
        void refreshAfterPatchloomInputChange(
          clearPatchloomStatusInflight,
          refreshStatusBar,
          refreshMcpServerBinary
        );
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refreshAfterPatchloomInputChange(
        clearPatchloomStatusInflight,
        refreshStatusBar,
        refreshMcpServerBinary
      );
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void refreshAfterPatchloomInputChange(
        clearPatchloomStatusInflight,
        refreshStatusBar,
        refreshMcpServerBinary
      );
    })
  );

  void refreshStatusBar();
  void checkForUpdates();
  void registerMcpServerProviderWithBinary(context);
}

export function deactivate(): void {
  clearPatchloomStatusInflight();
  setManagedInstallRoot(undefined);
  const log = getPatchloomLog();
  log?.dispose();
  setPatchloomLog(undefined);
  disposeStatusBar();
}
