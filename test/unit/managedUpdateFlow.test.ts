import assert from "node:assert/strict";
import test from "node:test";
import { runCheckedInstall } from "../../src/commands/managedUpdateFlow.js";

test("confirm runs after check ends and install starts only after confirm", async () => {
  const phases: string[] = [];
  await runCheckedInstall({
    onPhase: (phase) => phases.push(phase),
    check: async () => {
      phases.push("check-body");
      return "1.2.3";
    },
    confirm: async (version) => {
      assert.equal(version, "1.2.3");
      assert.deepEqual(phases, ["check", "check-body", "confirm"]);
      return true;
    },
    install: async () => {
      phases.push("install-body");
    }
  });
  assert.deepEqual(phases, ["check", "check-body", "confirm", "install", "install-body"]);
});

test("a declined confirm does not start install", async () => {
  let installed = false;
  await runCheckedInstall({
    check: async () => "current",
    confirm: async () => false,
    install: async () => {
      installed = true;
    }
  });
  assert.equal(installed, false);
});
