import * as vscode from "vscode";
import { resolvePatchloomStatus, comparePatchloomVersions, PATCHLOOM_RELEASES_URL, clearPatchloomStatusInflight } from "../binary/patchloom.js";
import {
  detectManagedInstallTarget,
  fetchLatestReleaseVersion,
  getManagedInstallRoot,
  ManagedInstallStage,
  performManagedInstall
} from "../install/managed.js";
import { getPatchloomLog } from "../logging/outputChannel.js";
import { refreshMcpServerBinary } from "../mcp/register.js";
import { refreshStatusBar } from "../status/statusBar.js";
import { formatError } from "../util.js";

const MANAGED_INSTALL_UNAVAILABLE =
  "Managed install is not available: extension storage path is not set.";

const PROGRESS_OPTIONS: vscode.ProgressOptions = {
  location: vscode.ProgressLocation.Notification,
  title: "Patchloom",
  cancellable: false,
};

function stageLabel(stage: ManagedInstallStage): string {
  switch (stage) {
    case "fetching-version":
      return "Checking for latest release...";
    case "downloading-checksum":
      return "Downloading checksum...";
    case "downloading-archive":
      return "Downloading Patchloom...";
    case "verifying":
      return "Verifying integrity...";
    case "extracting":
      return "Extracting archive...";
    case "installing":
      return "Installing binary...";
  }
}

export async function installPatchloom(): Promise<void> {
  const installRoot = getManagedInstallRoot();
  if (!installRoot) {
    await vscode.window.showErrorMessage(MANAGED_INSTALL_UNAVAILABLE);
    return;
  }

  const target = detectManagedInstallTarget();
  if (!target) {
    await vscode.window.showErrorMessage(
      `Managed install is not supported on this platform (${process.platform}/${process.arch}).`
    );
    return;
  }

  const log = getPatchloomLog();

  await vscode.window.withProgress(
    PROGRESS_OPTIONS,
    async (progress) => {
      try {
        const result = await performManagedInstall({
          installRoot,
          onProgress: (stage) => {
            progress.report({ message: stageLabel(stage) });
          }
        });

        log?.log(`Managed install complete: Patchloom ${result.version} at ${result.binaryPath}`);
        clearPatchloomStatusInflight();
        await refreshStatusBar();
        await refreshMcpServerBinary();
        await vscode.window.showInformationMessage(
          `Patchloom ${result.version} installed successfully.`
        );
      } catch (error) {
        const message = formatError(error);
        log?.log(`Managed install failed: ${message}`);
        await vscode.window.showErrorMessage(`Failed to install Patchloom: ${message}`);
      }
    }
  );
}

export async function updatePatchloom(): Promise<void> {
  const installRoot = getManagedInstallRoot();
  if (!installRoot) {
    await vscode.window.showErrorMessage(MANAGED_INSTALL_UNAVAILABLE);
    return;
  }

  const target = detectManagedInstallTarget();
  if (!target) {
    await vscode.window.showErrorMessage(
      `Managed install is not supported on this platform (${process.platform}/${process.arch}).`
    );
    return;
  }

  const log = getPatchloomLog();

  await vscode.window.withProgress(
    PROGRESS_OPTIONS,
    async (progress) => {
      try {
        progress.report({ message: "Checking for updates..." });
        const latestVersion = await fetchLatestReleaseVersion();

        const status = await resolvePatchloomStatus();
        if (status.detectedVersion && comparePatchloomVersions(latestVersion, status.detectedVersion) <= 0) {
          await vscode.window.showInformationMessage(
            `Patchloom ${status.detectedVersion} is already up to date.`
          );
          return;
        }

        const upgradeLabel = status.detectedVersion
          ? `${status.detectedVersion} to ${latestVersion}`
          : latestVersion;

        const choice = await vscode.window.showInformationMessage(
          `Patchloom ${upgradeLabel} is available. Install now?`,
          "Install",
          "View Release"
        );

        if (choice === "View Release") {
          await vscode.env.openExternal(
            vscode.Uri.parse(`${PATCHLOOM_RELEASES_URL}/tag/patchloom-v${latestVersion}`)
          );
          return;
        }

        if (choice !== "Install") {
          return;
        }

        const result = await performManagedInstall({
          installRoot,
          version: latestVersion,
          onProgress: (stage) => {
            progress.report({ message: stageLabel(stage) });
          }
        });

        log?.log(`Managed update complete: Patchloom ${result.version} at ${result.binaryPath}`);
        clearPatchloomStatusInflight();
        await refreshStatusBar();
        await refreshMcpServerBinary();
        await vscode.window.showInformationMessage(
          `Patchloom updated to ${result.version}.`
        );
      } catch (error) {
        const message = formatError(error);
        log?.log(`Managed update failed: ${message}`);
        await vscode.window.showErrorMessage(`Failed to update Patchloom: ${message}`);
      }
    }
  );
}

export async function reinstallPatchloom(): Promise<void> {
  const installRoot = getManagedInstallRoot();
  if (!installRoot) {
    await vscode.window.showErrorMessage(MANAGED_INSTALL_UNAVAILABLE);
    return;
  }

  const target = detectManagedInstallTarget();
  if (!target) {
    await vscode.window.showErrorMessage(
      `Managed install is not supported on this platform (${process.platform}/${process.arch}).`
    );
    return;
  }

  const choice = await vscode.window.showWarningMessage(
    "This will re-download and reinstall the Patchloom binary. Continue?",
    "Reinstall",
    "Cancel"
  );

  if (choice !== "Reinstall") {
    return;
  }

  const log = getPatchloomLog();

  await vscode.window.withProgress(
    PROGRESS_OPTIONS,
    async (progress) => {
      try {
        const result = await performManagedInstall({
          installRoot,
          onProgress: (stage) => {
            progress.report({ message: stageLabel(stage) });
          }
        });

        log?.log(`Managed reinstall complete: Patchloom ${result.version} at ${result.binaryPath}`);
        clearPatchloomStatusInflight();
        await refreshStatusBar();
        await refreshMcpServerBinary();
        await vscode.window.showInformationMessage(
          `Patchloom ${result.version} reinstalled successfully.`
        );
      } catch (error) {
        const message = formatError(error);
        log?.log(`Managed reinstall failed: ${message}`);
        await vscode.window.showErrorMessage(`Failed to reinstall Patchloom: ${message}`);
      }
    }
  );
}
