import assert from "node:assert/strict";
import test from "node:test";
import { formatSetupSummary } from "../../src/commands/setupSummary.js";

test("setup summary names skipped steps and a folder", () => {
  const summary = formatSetupSummary("demo", "skipped", "skipped");
  assert.match(summary, /demo/);
  assert.match(summary, /AGENTS.md was skipped/);
  assert.match(summary, /MCP config was skipped/);
  assert.match(formatSetupSummary(undefined, "present", "ran"), /already present/);
  assert.match(formatSetupSummary(undefined, "present", "ran"), /Configure MCP ran/);
});
