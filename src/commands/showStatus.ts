import * as vscode from "vscode";
import { resolvePatchloomStatus } from "../binary/patchloom";

export async function showStatus(): Promise<void> {
  const status = await resolvePatchloomStatus();
  const details = [
    status.ready ? "Patchloom is ready." : "Patchloom is not ready.",
    status.message,
    status.version ? `Version: ${status.version}` : undefined,
    status.binaryPath ? `Path: ${status.binaryPath}` : undefined
  ].filter((line): line is string => Boolean(line)).join("\n");

  if (status.ready) {
    await vscode.window.showInformationMessage(details);
    return;
  }

  const choice = await vscode.window.showWarningMessage(details, "Open Settings");
  if (choice === "Open Settings") {
    await vscode.commands.executeCommand("workbench.action.openSettings", "patchloom.path");
  }
}
