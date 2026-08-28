import assert from "node:assert/strict";
import test from "node:test";
import { decideManagedUpdate, resolveManagedBinaryVersion } from "../../src/binary/managedUpdate.js";

test("decideManagedUpdate offers latest when managed is missing", () => {
  assert.deepEqual(decideManagedUpdate("0.31.0", undefined), {
    kind: "available",
    to: "0.31.0"
  });
});

test("decideManagedUpdate offers upgrade when managed is older than latest", () => {
  assert.deepEqual(decideManagedUpdate("0.31.0", "0.28.0"), {
    kind: "available",
    from: "0.28.0",
    to: "0.31.0"
  });
});

test("decideManagedUpdate is current when managed matches latest", () => {
  assert.deepEqual(decideManagedUpdate("0.31.0", "0.31.0"), {
    kind: "current",
    version: "0.31.0"
  });
});

test("decideManagedUpdate is current when managed is newer than latest", () => {
  assert.deepEqual(decideManagedUpdate("0.28.0", "0.31.0"), {
    kind: "current",
    version: "0.31.0"
  });
});

test("resolveManagedBinaryVersion uses active version when source is managed", async () => {
  const probed: string[] = [];
  const version = await resolveManagedBinaryVersion(
    {
      source: "managed",
      detectedVersion: "0.28.0",
      managedInstall: {
        exists: true,
        binaryPath: "/managed/patchloom",
        target: {
          platform: "darwin",
          arch: "arm64",
          targetTriple: "aarch64-apple-darwin",
          archiveFormat: ".tar.xz"
        }
      }
    },
    async (binaryPath: string) => {
      probed.push(binaryPath);
      return "patchloom 0.99.0";
    }
  );
  assert.equal(version, "0.28.0");
  assert.deepEqual(probed, []);
});

test("resolveManagedBinaryVersion probes managed path when PATH is active", async () => {
  const probed: string[] = [];
  const version = await resolveManagedBinaryVersion(
    {
      source: "path",
      detectedVersion: "0.31.0",
      managedInstall: {
        exists: true,
        binaryPath: "/managed/patchloom",
        target: {
          platform: "darwin",
          arch: "arm64",
          targetTriple: "aarch64-apple-darwin",
          archiveFormat: ".tar.xz"
        }
      }
    },
    async (binaryPath: string) => {
      probed.push(binaryPath);
      return "patchloom 0.28.0";
    }
  );
  assert.equal(version, "0.28.0");
  assert.deepEqual(probed, ["/managed/patchloom"]);
});

test("resolveManagedBinaryVersion probes managed path when setting is active", async () => {
  const probed: string[] = [];
  const version = await resolveManagedBinaryVersion(
    {
      source: "setting",
      detectedVersion: "0.31.0",
      managedInstall: {
        exists: true,
        binaryPath: "/managed/patchloom",
        target: {
          platform: "darwin",
          arch: "arm64",
          targetTriple: "aarch64-apple-darwin",
          archiveFormat: ".tar.xz"
        }
      }
    },
    async (binaryPath: string) => {
      probed.push(binaryPath);
      return "patchloom 0.28.0";
    }
  );
  assert.equal(version, "0.28.0");
  assert.deepEqual(probed, ["/managed/patchloom"]);
});

test("resolveManagedBinaryVersion is undefined when managed exists is false", async () => {
  const probed: string[] = [];
  const version = await resolveManagedBinaryVersion(
    {
      source: "path",
      detectedVersion: "0.31.0",
      managedInstall: {
        exists: false,
        binaryPath: "/managed/patchloom",
        target: {
          platform: "darwin",
          arch: "arm64",
          targetTriple: "aarch64-apple-darwin",
          archiveFormat: ".tar.xz"
        }
      }
    },
    async (binaryPath: string) => {
      probed.push(binaryPath);
      return "patchloom 0.28.0";
    }
  );
  assert.equal(version, undefined);
  assert.deepEqual(probed, []);
});

test("resolveManagedBinaryVersion is undefined when the managed probe throws", async () => {
  const version = await resolveManagedBinaryVersion(
    {
      source: "path",
      detectedVersion: "0.31.0",
      managedInstall: {
        exists: true,
        binaryPath: "/managed/patchloom",
        target: {
          platform: "darwin",
          arch: "arm64",
          targetTriple: "aarch64-apple-darwin",
          archiveFormat: ".tar.xz"
        }
      }
    },
    async () => {
      throw new Error("not executable");
    }
  );
  assert.equal(version, undefined);
});

test("resolveManagedBinaryVersion is undefined when PATH is active and managed is missing", async () => {
  const probed: string[] = [];
  const version = await resolveManagedBinaryVersion(
    {
      source: "path",
      detectedVersion: "0.31.0"
    },
    async (binaryPath: string) => {
      probed.push(binaryPath);
      return "patchloom 0.28.0";
    }
  );
  assert.equal(version, undefined);
  assert.deepEqual(probed, []);
});
