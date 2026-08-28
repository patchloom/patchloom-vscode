/**
 * UI-driven integration tests using vscode-extension-tester.
 *
 * These tests launch a real VS Code window with Selenium WebDriver and
 * interact with the actual extension UI: status bar, command palette,
 * quick picks, dialogs, and settings editor.
 *
 * Run with: npm run test:ui
 */
import assert from "node:assert/strict";
import {
  VSBrowser,
  Workbench,
  StatusBar,
  InputBox,
  EditorView,
  SettingsEditor,
} from "vscode-extension-tester";

// ---------------------------------------------------------------------------
// Polling helpers (replace fixed setTimeout waits)
// ---------------------------------------------------------------------------

/** Poll fn until it returns a defined value, or throw after timeoutMs. */
async function poll<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result !== undefined) return result;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`poll timed out after ${timeoutMs}ms`);
}

/** Find and return the text of a status bar item containing "Patchloom". */
async function findPatchloomStatus(): Promise<string | undefined> {
  for (const item of await new StatusBar().getItems()) {
    try {
      const text = await item.getText();
      if (text.includes("Patchloom")) return text;
    } catch {
      // some items may not expose accessible text
    }
  }
  return undefined;
}

/** Find, dismiss, and return a notification matching the given pattern. */
async function findNotification(
  workbench: Workbench,
  pattern: RegExp,
): Promise<string | undefined> {
  for (const n of await workbench.getNotifications()) {
    try {
      const msg = await n.getMessage();
      if (pattern.test(msg)) {
        await n.dismiss();
        return msg;
      }
    } catch {
      // notification may have auto-dismissed
    }
  }
  return undefined;
}

/** Dismiss every currently visible notification matching the pattern. */
async function dismissNotifications(
  workbench: Workbench,
  pattern: RegExp,
): Promise<void> {
  while (await findNotification(workbench, pattern)) {
    // keep dismissing leftovers
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Patchloom Extension UI", function () {
  this.timeout(60_000);

  let workbench: Workbench;

  before(async function () {
    this.timeout(90_000);
    await VSBrowser.instance.waitForWorkbench();
    workbench = new Workbench();
    // Content-based activation (AGENTS.md / .patchloom.toml) may not fire in
    // the ExTester workspace. A Patchloom command loads the extension so the
    // status bar item exists before the suite runs.
    await workbench.executeCommand("Patchloom: Show Status");
    await poll(findPatchloomStatus, 30_000);
    // Drain leftover Show Status toasts so later tests do not match them.
    await poll(() => findNotification(workbench, /[Pp]atchloom/), 10_000).catch(() => undefined);
    await dismissNotifications(workbench, /[Pp]atchloom/);
  });

  describe("Status bar", function () {
    it("should display a Patchloom status bar item", async function () {
      const text = await poll(findPatchloomStatus);
      assert.ok(text.includes("Patchloom"), "status bar should contain a Patchloom item");
    });
  });

  describe("Show Status command", function () {
    it("should display a notification when invoked", async function () {
      await workbench.executeCommand("Patchloom: Show Status");
      const msg = await poll(
        () => findNotification(workbench, /ready|missing|version|AGENTS|status|not found/i),
      );
      assert.ok(msg, "Show Status should display a status notification");
    });
  });

  describe("Open Settings command", function () {
    it("should open settings filtered to patchloom", async function () {
      await workbench.executeCommand("Patchloom: Open Settings");
      await poll(async () => {
        const titles = await new EditorView().getOpenEditorTitles();
        return titles.some((t) => t.toLowerCase().includes("settings")) || undefined;
      });
      const setting = await new SettingsEditor().findSetting("Show Status Bar", "Patchloom");
      assert.ok(setting, "should find a Patchloom setting after Open Settings");
      await new EditorView().closeAllEditors();
    });
  });

  describe("Configure MCP command", function () {
    it("should show a notification or quick pick when invoked", async function () {
      await dismissNotifications(workbench, /[Pp]atchloom/);
      await workbench.executeCommand("Patchloom: Configure MCP");

      // The command shows either a warning (missing binary / MCP targets)
      // or a multi-select quick pick. Do not treat leftover Show Status as success.
      const result = await poll<{ kind: string }>(async () => {
        const msg = await findNotification(workbench, /MCP|configure|target|binary/i);
        if (msg) return { kind: "notification" };
        try {
          const input = new InputBox();
          await input.getText(); // throws if no input box visible
          return { kind: "input" };
        } catch {
          return undefined; // neither appeared yet, keep polling
        }
      });

      assert.ok(result, "Configure MCP should produce a notification or quick pick");
      if (result.kind === "input") {
        try { await new InputBox().cancel(); } catch { /* already gone */ }
      }
    });
  });

  describe("Quick Action command", function () {
    it("should show a notification or quick pick when invoked", async function () {
      await workbench.executeCommand("Patchloom: Quick Action");

      const result = await poll<{ kind: string; labels?: string[] }>(async () => {
        const msg = await findNotification(workbench, /upgrade|install|ready|not found/i);
        if (msg) return { kind: "notification" };
        try {
          const input = new InputBox();
          const picks = await input.getQuickPicks();
          const labels: string[] = [];
          for (const pick of picks) labels.push(await pick.getLabel());
          if (labels.some((label) => label.includes("Replace") || label.includes("Tidy"))) {
            return { kind: "input", labels };
          }
          return undefined;
        } catch {
          return undefined; // keep polling
        }
      }, 15_000);

      assert.ok(result, "Quick Action should produce a notification or quick pick");
      if (result.kind === "input") {
        assert.ok(
          result.labels!.some((l) => l.includes("Replace") || l.includes("Tidy")),
          `quick pick should contain Replace or Tidy, got: ${result.labels!.join(", ")}`,
        );
        try { await new InputBox().cancel(); } catch { /* already gone */ }
      }
    });
  });

  describe("Configuration changes", function () {
    it("should show Patchloom setting in the settings editor", async function () {
      await poll(findPatchloomStatus);
      const settingsEditor = await workbench.openSettings();
      const setting = await settingsEditor.findSetting("Show Status Bar", "Patchloom");
      assert.ok(setting, "should find the showStatusBar setting");
      await workbench.executeCommand("workbench.action.closeActiveEditor");
    });
  });

  after(async function () {
    try { await new EditorView().closeAllEditors(); } catch { /* none open */ }
    try {
      for (const n of await workbench.getNotifications()) {
        try { await n.dismiss(); } catch { /* already dismissed */ }
      }
    } catch { /* no notifications */ }
  });
});
