import { patchloomNeedsUpgrade, resolvePatchloomStatus } from "../binary/patchloom";
import { buildStatusDetails, preferredStatusAction } from "../status/details";
import { inspectWorkspaceReadiness } from "../workspace/readiness";

export { buildStatusDetails, preferredStatusAction, type SetupAction } from "../status/details";

export async function showStatus(): Promise<void> {
  const vscode = await import("vscode");
  const status = await resolvePatchloomStatus();
  const workspaceReadiness = await inspectWorkspaceReadiness({
    promptIfMany: true,
    placeHolder: "Select the workspace folder to inspect for Patchloom status"
  });
  const details = buildStatusDetails(status, workspaceReadiness);
  const action = preferredStatusAction(status, workspaceReadiness);

  if (!action) {
    await vscode.window.showInformationMessage(details);
    return;
  }

  const messageFn = (!status.ready || patchloomNeedsUpgrade(status))
    ? vscode.window.showWarningMessage
    : vscode.window.showInformationMessage;
  const choice = await messageFn(details, action.title);
  if (choice === action.title) {
    await vscode.commands.executeCommand(action.command);
  }
}
