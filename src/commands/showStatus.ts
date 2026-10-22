import { patchloomNeedsUpgrade, resolvePatchloomStatus } from "../binary/patchloom.js";
import { getPatchloomLog } from "../logging/outputChannel.js";
import { buildStatusDetails, preferredStatusAction, statusNotificationSummary } from "../status/details.js";
import { inspectWorkspaceReadiness } from "../workspace/readiness.js";

export { buildStatusDetails, preferredStatusAction, statusNotificationSummary, type SetupAction } from "../status/details.js";

export async function showStatus(): Promise<void> {
  const vscode = await import("vscode");
  const status = await resolvePatchloomStatus();
  const workspaceReadiness = await inspectWorkspaceReadiness({
    promptIfMany: true,
    placeHolder: "Select the workspace folder to inspect for Patchloom status"
  });
  const details = buildStatusDetails(status, workspaceReadiness);
  const log = getPatchloomLog();
  log?.log(details);
  log?.show();

  const needsUpgrade = patchloomNeedsUpgrade(status);
  const summary = statusNotificationSummary(status.ready, needsUpgrade);
  const action = preferredStatusAction(status, workspaceReadiness);
  const messageFn = (!status.ready || needsUpgrade)
    ? vscode.window.showWarningMessage
    : vscode.window.showInformationMessage;
  const choice = action
    ? await messageFn(summary, action.title)
    : await messageFn(summary);
  if (action && choice === action.title) {
    await vscode.commands.executeCommand(action.command);
  }
}
