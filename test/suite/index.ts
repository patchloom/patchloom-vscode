import assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("patchloom.patchloom");
  assert.ok(extension, "Patchloom extension should be registered");

  await extension.activate();
  assert.equal(extension.isActive, true);

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("patchloom.initializeProject"));
  assert.ok(commands.includes("patchloom.showStatus"));
}
