import assert from "node:assert/strict";
import test from "node:test";
import { findOnPath, resolvePatchloomStatusWithInputs } from "../../src/binary/patchloom";

test("resolvePatchloomStatusWithInputs prefers patchloom.path over PATH", async () => {
  const status = await resolvePatchloomStatusWithInputs({
    configuredPath: "  /custom/patchloom  ",
    pathValue: "/usr/local/bin:/bin",
    canExecute: async (candidate) => candidate === "/custom/patchloom",
    getVersion: async () => "patchloom 0.1.0"
  });

  assert.equal(status.ready, true);
  assert.equal(status.source, "setting");
  assert.equal(status.binaryPath, "/custom/patchloom");
  assert.equal(status.version, "patchloom 0.1.0");
});

test("resolvePatchloomStatusWithInputs reports missing binary cleanly", async () => {
  const status = await resolvePatchloomStatusWithInputs({
    configuredPath: "",
    pathValue: "/usr/local/bin:/bin",
    canExecute: async () => false,
    getVersion: async () => undefined
  });

  assert.equal(status.ready, false);
  assert.equal(status.source, "missing");
  assert.match(status.message, /not found/i);
});

test("resolvePatchloomStatusWithInputs reports version execution failures", async () => {
  const status = await resolvePatchloomStatusWithInputs({
    configuredPath: "/custom/patchloom",
    canExecute: async () => true,
    getVersion: async () => {
      throw new Error("boom");
    }
  });

  assert.equal(status.ready, false);
  assert.equal(status.source, "setting");
  assert.match(status.message, /failed to run --version/i);
  assert.match(status.message, /boom/);
});

test("findOnPath respects win32 PATH separators and command names", async () => {
  const found = await findOnPath(
    "C:\\tools;C:\\bin",
    "win32",
    async (candidate) => candidate === "C:\\bin\\patchloom.exe"
  );

  assert.equal(found, "C:\\bin\\patchloom.exe");
});
