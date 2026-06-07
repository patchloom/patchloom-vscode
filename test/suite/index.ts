import assert from "node:assert/strict";
import * as vscode from "vscode";

const EXPECTED_COMMANDS = [
  "patchloom.initializeProject",
  "patchloom.setupWorkspace",
  "patchloom.configureMcp",
  "patchloom.quickAction",
  "patchloom.batchApply",
  "patchloom.showOutput",
  "patchloom.openPatchloomSettings",
  "patchloom.openPatchloomReleases",
  "patchloom.showStatus",
  "patchloom.installBinary",
  "patchloom.updateBinary",
  "patchloom.reinstallBinary",
  "patchloom.verifyMcp",
  "patchloom.openDocumentation"
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

  // Activation events include content-based triggers
  const activationEvents = packageJson.activationEvents as string[];
  assert.ok(activationEvents.includes("workspaceContains:**/AGENTS.md"),
    "should activate on AGENTS.md presence");
  assert.ok(activationEvents.includes("workspaceContains:**/.patchloom.toml"),
    "should activate on .patchloom.toml presence");

  // Extension remains active throughout test lifecycle
  assert.ok(extension.isActive, "extension should still be active after assertions");

  // Configuration type validation
  const pathSchema = properties["patchloom.path"] as Record<string, unknown>;
  assert.equal(pathSchema.type, "string", "patchloom.path should be a string type");
  assert.equal(pathSchema.default, "", "patchloom.path default should be empty");

  const statusBarSchema = properties["patchloom.showStatusBar"] as Record<string, unknown>;
  assert.equal(statusBarSchema.type, "boolean", "patchloom.showStatusBar should be boolean type");
  assert.equal(statusBarSchema.default, true, "patchloom.showStatusBar default should be true");

  // New settings contributed
  assert.ok(properties["patchloom.enable"], "should contribute patchloom.enable setting");
  assert.ok(properties["patchloom.trace.server"], "should contribute patchloom.trace.server setting");
  assert.ok(properties["patchloom.env"], "should contribute patchloom.env setting");
  assert.ok(properties["patchloom.managedInstall.autoUpdate"], "should contribute patchloom.managedInstall.autoUpdate setting");

  // Extension has required license and repo metadata
  assert.equal(packageJson.license, "MIT");
  assert.ok(typeof (packageJson.repository as Record<string, unknown>).url === "string",
    "should have a repository URL");
  assert.ok(typeof packageJson.description === "string" && (packageJson.description as string).length > 0,
    "should have a non-empty description");
}
