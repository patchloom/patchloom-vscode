import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { patchloomNeedsUpgrade, resolvePatchloomStatus } from "../binary/patchloom";
import { configureMcpTargets, inspectMcpTargets } from "../mcp/config";
import { activeWorkspaceFolder, describeWorkspaceEnvironment } from "../workspace/readiness";
import { refreshStatusBar } from "../status/statusBar";

export async function configureMcp(): Promise<void> {
  const status = await resolvePatchloomStatus();
  if (!status.ready) {
    const choice = await vscode.window.showWarningMessage(
      `${status.message}\n\nPatchloom needs a working binary before MCP setup can continue.`,
      "Open Settings"
    );
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand("patchloom.openPatchloomSettings");
    }
    return;
  }

  if (patchloomNeedsUpgrade(status)) {
    const choice = await vscode.window.showWarningMessage(
      `${status.compatibilityMessage}\n\nUpgrade Patchloom before MCP setup can continue.`,
      "Open Releases"
    );
    if (choice === "Open Releases") {
      await vscode.commands.executeCommand("patchloom.openPatchloomReleases");
    }
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

  const selectedKinds = selections.map((selection) => selection.target.kind);
  const results = await configureMcpTargets({
    workspaceFolderPath,
    includeKinds: selectedKinds,
    includeUserTarget: environment.supportsUserMcpConfig,
    patchloomPathSetting: status.binaryPath,
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
