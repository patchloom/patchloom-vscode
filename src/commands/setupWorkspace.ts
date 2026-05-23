import * as vscode from "vscode";
import { resolvePatchloomStatus } from "../binary/patchloom";
import { inspectWorkspaceReadiness } from "../workspace/readiness";

export async function setupWorkspace(): Promise<void> {
  const status = await resolvePatchloomStatus();
  if (!status.ready) {
    const choice = await vscode.window.showWarningMessage(
      `${status.message}\n\nPatchloom needs a working binary before workspace setup can continue.`,
      "Open Settings"
    );
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand("patchloom.openPatchloomSettings");
    }
    return;
  }

  const readiness = await inspectWorkspaceReadiness();
  if (!readiness.hasWorkspace) {
    await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom: Setup Workspace.");
    return;
  }

  if (readiness.hasAgentsFile === false) {
    const choice = await vscode.window.showInformationMessage(
      "AGENTS.md is missing for this workspace. Create it now from patchloom agent-rules?",
      "Initialize Project"
    );
    if (choice === "Initialize Project") {
      await vscode.commands.executeCommand("patchloom.initializeProject");
    }
    return;
  }

  await vscode.window.showInformationMessage("Patchloom workspace setup looks good. Binary and AGENTS.md are already in place.");
}

export async function openPatchloomSettings(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.openSettings", "patchloom");
}
