import * as vscode from "vscode";
import { PATCHLOOM_RELEASES_URL, patchloomNeedsUpgrade, resolvePatchloomStatus } from "../binary/patchloom";
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
  if (patchloomNeedsUpgrade(status)) {
    const choice = await vscode.window.showWarningMessage(
      `${status.compatibilityMessage}\n\nUpgrade Patchloom before workspace setup can continue.`,
      "Open Releases"
    );
    if (choice === "Open Releases") {
      await vscode.commands.executeCommand("patchloom.openPatchloomReleases");
    }
    return;
  }

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

  if (readiness.hasMcpConfig === false) {
    const choice = await vscode.window.showInformationMessage(
      "Patchloom MCP config is missing. Configure supported editors now?",
      "Configure MCP"
    );
    if (choice === "Configure MCP") {
      await vscode.commands.executeCommand("patchloom.configureMcp");
    }
    return;
  }

  await vscode.window.showInformationMessage("Patchloom workspace setup looks good. Binary, AGENTS.md, and MCP config are already in place.");
}

export async function openPatchloomSettings(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.openSettings", "patchloom");
}

export async function openPatchloomReleases(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(PATCHLOOM_RELEASES_URL));
}
