import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { resolvePatchloomStatus } from "../binary/patchloom";
import { configureMcpTargets, inspectMcpTargets } from "../mcp/config";
import { activeWorkspaceFolder } from "../workspace/readiness";
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

  const folder = await activeWorkspaceFolder();
  const workspaceFolderPath = folder?.uri.fsPath;
  const targets = await inspectMcpTargets({ workspaceFolderPath });
  const selectable = targets.map((target) => ({
    label: target.label,
    description: target.filePath,
    detail: target.configured ? "Already configured" : target.exists ? "Config file exists" : "Config file will be created",
    target
  }));

  if (selectable.length === 0) {
    await vscode.window.showWarningMessage("No supported MCP config targets were found for this environment.");
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
