import * as vscode from "vscode";
import { ensurePatchloomReadyOrNotify, PATCHLOOM_DOCS_URL, PATCHLOOM_RELEASES_URL } from "../binary/patchloom.js";
import { formatSetupSummary, type SetupStepState } from "./setupSummary.js";
import { activeWorkspaceFolder, describeWorkspaceEnvironment, inspectWorkspaceReadiness } from "../workspace/readiness.js";

export { formatSetupSummary, type SetupStepState } from "./setupSummary.js";

export async function setupWorkspace(): Promise<void> {
  const binaryPath = await ensurePatchloomReadyOrNotify("Patchloom needs a working binary before workspace setup can continue.");
  if (!binaryPath) {
    return;
  }

  const folder = await activeWorkspaceFolder({
    promptIfMany: true,
    placeHolder: "Select the workspace folder to inspect for Patchloom setup"
  });
  if (!folder) {
    await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom: Setup Workspace.");
    return;
  }

  const readiness = await inspectWorkspaceReadiness({ folder });
  if (!readiness.hasWorkspace) {
    await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom: Setup Workspace.");
    return;
  }

  const agentsMissing = readiness.hasAgentsFile === false;
  let agents: SetupStepState = agentsMissing ? "skipped" : "present";
  if (agentsMissing) {
    const choice = await vscode.window.showInformationMessage(
      "Step 1/2: AGENTS.md is missing for this workspace. Create it now from patchloom agent-rules?",
      "Initialize Project",
      "Skip"
    );
    if (choice === "Initialize Project") {
      const wrote = await vscode.commands.executeCommand("patchloom.initializeProject", folder);
      if (wrote === true) {
        agents = "ran";
      }
    }
  }

  let mcp: SetupStepState = readiness.hasMcpConfig === false ? "skipped" : "present";
  if (readiness.hasMcpConfig === false) {
    const choice = await vscode.window.showInformationMessage(
      `${agentsMissing ? "Step 2/2: " : ""}Patchloom MCP config is missing. Configure supported editors now?`,
      "Configure MCP",
      "Skip"
    );
    if (choice === "Configure MCP") {
      const wrote = await vscode.commands.executeCommand("patchloom.configureMcp", folder);
      if (wrote === true) {
        mcp = "ran";
      }
    }
  }

  const environment = describeWorkspaceEnvironment(vscode.env.remoteName);
  await vscode.window.showInformationMessage(
    formatSetupSummary(readiness.workspaceName, agents, mcp, environment.note)
  );
}

export async function openPatchloomSettings(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.openSettings", "patchloom");
}

export async function openPatchloomReleases(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(PATCHLOOM_RELEASES_URL));
}

export async function openDocumentation(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(PATCHLOOM_DOCS_URL));
}
