import assert from "node:assert/strict";
import * as vscode from "vscode";

const EXPECTED_COMMANDS = [
  "patchloom.initializeProject",
  "patchloom.setupWorkspace",
  "patchloom.configureMcp",
  "patchloom.quickAction",
  "patchloom.openPatchloomSettings",
  "patchloom.openPatchloomReleases",
  "patchloom.showStatus"
];

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("patchloom.patchloom");
  assert.ok(extension, "Patchloom extension should be registered");

  await extension.activate();
  assert.equal(extension.isActive, true);

  // Command registration
  const commands = await vscode.commands.getCommands(true);
  for (const cmd of EXPECTED_COMMANDS) {
    assert.ok(commands.includes(cmd), `command ${cmd} should be registered`);
  }

  // Configuration properties are contributed
  const config = vscode.workspace.getConfiguration("patchloom");
  const pathSetting = config.get<string>("path");
  assert.equal(pathSetting, "", "patchloom.path should default to empty string");

  const showStatusBar = config.get<boolean>("showStatusBar");
  assert.equal(showStatusBar, true, "patchloom.showStatusBar should default to true");

  // Package contributes the expected number of commands
  const packageJson = extension.packageJSON as Record<string, unknown>;
  const contributes = packageJson.contributes as Record<string, unknown>;
  const contributedCommands = contributes.commands as Array<Record<string, unknown>>;
  assert.equal(contributedCommands.length, EXPECTED_COMMANDS.length,
    `should contribute exactly ${EXPECTED_COMMANDS.length} commands`);

  for (const cmd of contributedCommands) {
    assert.equal(cmd.category, "Patchloom", `command ${cmd.command} should have category Patchloom`);
    assert.ok(typeof cmd.title === "string" && cmd.title.length > 0,
      `command ${cmd.command} should have a non-empty title`);
  }

  // Extension metadata
  assert.equal(packageJson.publisher, "patchloom");
  assert.ok(typeof packageJson.version === "string");
  assert.ok((packageJson.engines as Record<string, string>).vscode);

  // Configuration schema has expected properties
  const configSchema = contributes.configuration as Record<string, unknown>;
  const properties = configSchema.properties as Record<string, unknown>;
  assert.ok(properties["patchloom.path"], "should contribute patchloom.path setting");
  assert.ok(properties["patchloom.showStatusBar"], "should contribute patchloom.showStatusBar setting");
}
