import assert from "node:assert/strict";
import test from "node:test";
import { decideStatusPresentation, shouldRunBackgroundChecks } from "../../src/status/contextKeys.js";

test("context keys stay set when the status bar is hidden", () => {
  const hidden = decideStatusPresentation({
    extensionEnabled: true,
    statusBarEnabled: false,
    cliReady: true,
    managedInstallExists: false,
    projectInitialized: false
  });
  assert.equal(hidden.showStatusBar, false);
  assert.equal(hidden.runBackgroundChecks, true);
  assert.equal(hidden.context.cliAvailable, true);
  assert.equal(hidden.statusBarCommand, "patchloom.showStatus");
});

test("disabling the extension hides the bar and skips background checks but still records the CLI", () => {
  const disabled = decideStatusPresentation({
    extensionEnabled: false,
    statusBarEnabled: true,
    cliReady: true,
    managedInstallExists: true,
    projectInitialized: true
  });
  assert.equal(disabled.showStatusBar, false);
  assert.equal(disabled.runBackgroundChecks, false);
  assert.deepEqual(disabled.context, {
    cliAvailable: true,
    managedInstallExists: true,
    projectInitialized: true
  });
  assert.equal(shouldRunBackgroundChecks(false), false);
  assert.equal(shouldRunBackgroundChecks(true), true);
});
