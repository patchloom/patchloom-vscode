import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { ensurePatchloomReadyOrNotify } from "../binary/patchloom.js";
import { getPatchloomLog, writeUserVisibleOutput } from "../logging/outputChannel.js";
import {
  configureMcpTargets,
  formatMcpConfigureFailureMessage,
  inspectMcpTargets,
  McpConfigureError,
  readMcpConfigText
} from "../mcp/config.js";
import { refreshStatusBar } from "../status/statusBar.js";
import { activeWorkspaceFolder, describeWorkspaceEnvironment } from "../workspace/readiness.js";

export async function configureMcp(preset?: vscode.WorkspaceFolder): Promise<boolean> {
  const binaryPath = await ensurePatchloomReadyOrNotify("Patchloom needs a working binary before MCP setup can continue.");
  if (!binaryPath) {
    return false;
  }

  const folder = preset ?? await activeWorkspaceFolder({
    promptIfMany: true,
    placeHolder: "Select the workspace folder to configure for Patchloom MCP"
  });
  const workspaceFolderPath = folder?.uri.fsPath;
  const environment = describeWorkspaceEnvironment(vscode.env.remoteName);
  const targets = await inspectMcpTargets({
    workspaceFolderPath,
    includeUserTarget: environment.supportsUserMcpConfig
  });
  const selectable = targets.map((target) => ({
    label: target.label,
    description: target.filePath,
    detail: targetDetail(target),
    target
  }));

  if (selectable.length === 0) {
    const detail = environment.note ? ` ${environment.note}` : "";
    await vscode.window.showWarningMessage(`No supported MCP config targets were found for this environment.${detail}`);
    return false;
  }

  const selections = await vscode.window.showQuickPick(selectable, {
    canPickMany: true,
    placeHolder: "Select editor config targets for Patchloom MCP setup"
  });
  if (!selections || selections.length === 0) {
    return false;
  }

  const surfacePick = await vscode.window.showQuickPick(
    [
      {
        label: "Full tool inventory",
        description: "Default (66 tools on CLI 0.37+; verified on 0.37.5)",
        surface: "full" as const
      },
      {
        label: "Core pack",
        description: "Sets PATCHLOOM_MCP_SURFACE=core (12 tools on CLI 0.37+; verified on 0.37.5; 11 on 0.22-0.36)",
        surface: "core" as const
      }
    ],
    { placeHolder: "Which MCP tool surface should the server expose?" }
  );
  if (!surfacePick) {
    return false;
  }

  let chosen = selections;
  if (chosen.some((selection) => selection.target.kind === "vscode-workspace")) {
    const proceed = await vscode.window.showWarningMessage(
      "VS Code already starts the native Patchloom MCP server. Writing .vscode/mcp.json adds a second server next to that provider.",
      "Write file",
      "Skip that file"
    );
    if (proceed !== "Write file") {
      chosen = chosen.filter((selection) => selection.target.kind !== "vscode-workspace");
      if (chosen.length === 0) {
        return false;
      }
    }
  }

  const selectedKinds = chosen.map((selection) => selection.target.kind);
  let results;
  try {
    results = await configureMcpTargets({
      workspaceFolderPath,
      includeKinds: selectedKinds,
      includeUserTarget: environment.supportsUserMcpConfig,
      patchloomPathSetting: binaryPath,
      mcpSurface: surfacePick.surface,
      readFile: readMcpConfigText,
      writeFile: async (filePath, content) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      }
    });
  } catch (error) {
    const message = formatMcpConfigureFailureMessage(error);
    const log = getPatchloomLog();
    writeUserVisibleOutput(log, message);
    log?.show();
    await vscode.window.showErrorMessage(message);
    if (error instanceof McpConfigureError && error.completed.some((result) => result.changed)) {
      await refreshStatusBar();
    }
    return false;
  }

  const applied = results;
  const changed = applied.filter((result) => result.changed);
  const untouched = applied.filter((result) => !result.changed);
  const summary = [
    changed.length > 0 ? `Updated ${changed.length} MCP config target(s).` : undefined,
    untouched.length > 0 ? `${untouched.length} target(s) were already configured.` : undefined
  ].filter((line): line is string => Boolean(line)).join(" ");

  await refreshStatusBar();
  await vscode.window.showInformationMessage(summary || "Patchloom MCP setup completed.");
  return true;
}

function targetDetail(target: { kind: string; configured: boolean; exists: boolean }): string {
  const state = target.configured
    ? "Already configured"
    : target.exists
      ? "Config file exists"
      : "Config file will be created";
  if (target.kind === "portable-workspace") {
    return `${state}. Preferred for current VS Code and Copilot`;
  }
  if (target.kind === "vscode-workspace") {
    return `${state}. Older VS Code location. This file is a second server next to the native provider`;
  }
  return state;
}
