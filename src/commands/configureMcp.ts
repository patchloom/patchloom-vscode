import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { ensurePatchloomReadyOrNotify } from "../binary/patchloom.js";
import { configureMcpTargets, inspectMcpTargets } from "../mcp/config.js";
import { activeWorkspaceFolder, describeWorkspaceEnvironment } from "../workspace/readiness.js";
import { refreshStatusBar } from "../status/statusBar.js";

export async function configureMcp(): Promise<void> {
  const binaryPath = await ensurePatchloomReadyOrNotify("Patchloom needs a working binary before MCP setup can continue.");
  if (!binaryPath) {
    return;
  }

  const folder = await activeWorkspaceFolder({
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
    detail: target.configured ? "Already configured" : target.exists ? "Config file exists" : "Config file will be created",
    target
  }));

  if (selectable.length === 0) {
    const detail = environment.note ? ` ${environment.note}` : "";
    await vscode.window.showWarningMessage(`No supported MCP config targets were found for this environment.${detail}`);
    return;
  }

  const selections = await vscode.window.showQuickPick(selectable, {
    canPickMany: true,
    placeHolder: "Select editor config targets for Patchloom MCP setup"
  });
  if (!selections || selections.length === 0) {
    return;
  }

  const surfacePick = await vscode.window.showQuickPick(
    [
      {
        label: "Full tool inventory",
        description: "Default (58 tools on CLI 0.24+; verified on 0.28)",
        surface: "full" as const
      },
      {
        label: "Core pack",
        description: "Sets PATCHLOOM_MCP_SURFACE=core (11 tools; CLI 0.22+)",
        surface: "core" as const
      }
    ],
    { placeHolder: "Which MCP tool surface should the server expose?" }
  );
  if (!surfacePick) {
    return;
  }

  const selectedKinds = selections.map((selection) => selection.target.kind);
  const results = await configureMcpTargets({
    workspaceFolderPath,
    includeKinds: selectedKinds,
    includeUserTarget: environment.supportsUserMcpConfig,
    patchloomPathSetting: binaryPath,
    mcpSurface: surfacePick.surface,
    readFile: async (filePath) => {
      try {
        return await fs.readFile(filePath, "utf8");
      } catch {
        return undefined;
      }
    },
    writeFile: async (filePath, content) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    }
  });

  const applied = results;
  const changed = applied.filter((result) => result.changed);
  const untouched = applied.filter((result) => !result.changed);
  const summary = [
    changed.length > 0 ? `Updated ${changed.length} MCP config target(s).` : undefined,
    untouched.length > 0 ? `${untouched.length} target(s) were already configured.` : undefined
  ].filter((line): line is string => Boolean(line)).join(" ");

  await refreshStatusBar();
  await vscode.window.showInformationMessage(summary || "Patchloom MCP setup completed.");
}
