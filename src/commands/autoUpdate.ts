import * as vscode from "vscode";
import { comparePatchloomVersions, PATCHLOOM_RELEASES_URL, resolvePatchloomStatus } from "../binary/patchloom.js";
import { fetchLatestReleaseVersion, getManagedInstallRoot } from "../install/managed.js";
import { getPatchloomLog } from "../logging/outputChannel.js";

export async function checkForUpdates(): Promise<void> {
  const config = vscode.workspace.getConfiguration("patchloom");
  if (!config.get<boolean>("enable", true)) {
    return;
  }
  if (!config.get<boolean>("managedInstall.autoUpdate", true)) {
    return;
  }

  const installRoot = getManagedInstallRoot();
  if (!installRoot) {
    return;
  }

  const status = await resolvePatchloomStatus();
  if (!status.ready || !status.detectedVersion || status.source !== "managed") {
    return;
  }

  const log = getPatchloomLog();
  try {
    const latestVersion = await fetchLatestReleaseVersion();
    if (comparePatchloomVersions(latestVersion, status.detectedVersion) <= 0) {
      return;
    }

    log?.log(`Update available: ${status.detectedVersion} -> ${latestVersion}`);
    const choice = await vscode.window.showInformationMessage(
      `Patchloom v${latestVersion} is available (current: v${status.detectedVersion}).`,
      "Update Now",
      "View Release"
    );

    if (choice === "Update Now") {
      await vscode.commands.executeCommand("patchloom.updateBinary");
    } else if (choice === "View Release") {
      await vscode.env.openExternal(
        vscode.Uri.parse(`${PATCHLOOM_RELEASES_URL}/tag/patchloom-v${latestVersion}`)
      );
    }
  } catch (error) {
    log?.log(`Auto-update check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
