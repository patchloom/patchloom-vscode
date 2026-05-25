import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  clearManagedInstallFailure,
  clearManagedInstallFailureRecord,
  clearManagedInstallStaging,
  detectManagedInstallTarget,
  inspectManagedInstallStatus,
  loadManagedInstallFailure,
  persistManagedInstallFailure,
  promoteManagedInstallBinary,
  resolveManagedInstallTransactionPaths,
  type ManagedInstallFailure
} from "../../src/install/managed.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "patchloom-managed-test-"));
  try {
    await fn(dir);
  } finally {
    clearManagedInstallFailure();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("promoteManagedInstallBinary moves a staged binary to the live path with real files", async () => {
  await withTempDir(async (installRoot) => {
    const target = detectManagedInstallTarget("darwin", "arm64");
    assert.ok(target);
    const paths = resolveManagedInstallTransactionPaths(installRoot, "0.1.0", target);

    await fs.mkdir(path.dirname(paths.stagedBinaryPath), { recursive: true });
    await fs.writeFile(paths.stagedBinaryPath, "#!/bin/sh\necho patchloom 0.1.0\n", "utf8");

    await promoteManagedInstallBinary({ paths });

    assert.equal(await fileExists(paths.binaryPath), true, "live binary should exist");
    assert.equal(await fileExists(paths.stagedBinaryPath), false, "staged binary should be gone");
    assert.equal(await fileExists(paths.backupBinaryPath), false, "no backup when no prior binary");

    const content = await fs.readFile(paths.binaryPath, "utf8");
    assert.match(content, /patchloom 0\.1\.0/);
  });
});

test("promoteManagedInstallBinary replaces an existing binary and removes the backup", async () => {
  await withTempDir(async (installRoot) => {
    const target = detectManagedInstallTarget("darwin", "arm64");
    assert.ok(target);
    const paths = resolveManagedInstallTransactionPaths(installRoot, "0.1.0", target);

    await fs.mkdir(path.dirname(paths.binaryPath), { recursive: true });
    await fs.writeFile(paths.binaryPath, "old-binary-content", "utf8");

    await fs.mkdir(path.dirname(paths.stagedBinaryPath), { recursive: true });
    await fs.writeFile(paths.stagedBinaryPath, "new-binary-content", "utf8");

    await promoteManagedInstallBinary({ paths });

    const content = await fs.readFile(paths.binaryPath, "utf8");
    assert.equal(content, "new-binary-content");
    assert.equal(await fileExists(paths.backupBinaryPath), false, "backup cleaned up after success");
    assert.equal(await fileExists(paths.stagedBinaryPath), false, "staged binary removed");
  });
});

test("promoteManagedInstallBinary rolls back on rename failure with real files", async () => {
  await withTempDir(async (installRoot) => {
    const target = detectManagedInstallTarget("darwin", "arm64");
    assert.ok(target);
    const paths = resolveManagedInstallTransactionPaths(installRoot, "0.1.0", target);

    await fs.mkdir(path.dirname(paths.binaryPath), { recursive: true });
    await fs.writeFile(paths.binaryPath, "original-binary", "utf8");

    await fs.mkdir(path.dirname(paths.stagedBinaryPath), { recursive: true });
    await fs.writeFile(paths.stagedBinaryPath, "staged-binary", "utf8");

    const storageRoot = path.join(installRoot, "storage");

    await assert.rejects(
      () => promoteManagedInstallBinary({
        paths,
        renameFile: async (from, to) => {
          if (from === paths.stagedBinaryPath && to === paths.binaryPath) {
            throw new Error("permission denied");
          }
          await fs.rename(from, to);
        },
        failurePersistence: { storageRoot }
      }),
      /Failed to replace managed Patchloom binary/
    );

    const content = await fs.readFile(paths.binaryPath, "utf8");
    assert.equal(content, "original-binary", "original binary restored after rollback");

    const failure = await loadManagedInstallFailure({ storageRoot });
    assert.ok(failure);
    assert.equal(failure.stage, "replace");
    assert.equal(failure.reason, "replace-failed");
  });
});

test("clearManagedInstallStaging removes a real staging directory", async () => {
  await withTempDir(async (installRoot) => {
    const target = detectManagedInstallTarget("darwin", "arm64");
    assert.ok(target);
    const paths = resolveManagedInstallTransactionPaths(installRoot, "0.1.0", target);

    await fs.mkdir(paths.stagingRoot, { recursive: true });
    await fs.writeFile(path.join(paths.stagingRoot, "archive.tar.xz"), "fake-archive", "utf8");
    await fs.writeFile(path.join(paths.stagingRoot, "archive.tar.xz.sha256"), "abcdef", "utf8");

    assert.equal(await fileExists(paths.stagingRoot), true);

    await clearManagedInstallStaging({ paths });

    assert.equal(await fileExists(paths.stagingRoot), false, "staging directory should be removed");
  });
});

test("persistManagedInstallFailure and loadManagedInstallFailure round-trip through real files", async () => {
  await withTempDir(async (storageRoot) => {
    clearManagedInstallFailure();

    const failure: ManagedInstallFailure = {
      stage: "download",
      reason: "download-failed",
      message: "HTTP 503 from GitHub releases."
    };

    await persistManagedInstallFailure(failure, { storageRoot });
    clearManagedInstallFailure();

    const loaded = await loadManagedInstallFailure({ storageRoot });
    assert.deepEqual(loaded, failure);
  });
});

test("clearManagedInstallFailureRecord removes the failure file on disk", async () => {
  await withTempDir(async (storageRoot) => {
    await persistManagedInstallFailure({
      stage: "verify",
      reason: "checksum-mismatch",
      message: "Checksum mismatch."
    }, { storageRoot });

    const failurePath = path.join(storageRoot, "managed-install-failure.json");
    assert.equal(await fileExists(failurePath), true, "failure file should exist after persist");

    await clearManagedInstallFailureRecord({ storageRoot });
    assert.equal(await fileExists(failurePath), false, "failure file should be removed after clear");

    clearManagedInstallFailure();
    const loaded = await loadManagedInstallFailure({ storageRoot });
    assert.equal(loaded, undefined);
  });
});

test("inspectManagedInstallStatus detects a real binary on disk", async () => {
  await withTempDir(async (installRoot) => {
    const target = detectManagedInstallTarget("darwin", "arm64");
    assert.ok(target);
    const paths = resolveManagedInstallTransactionPaths(installRoot, "0.1.0", target);

    await fs.mkdir(path.dirname(paths.binaryPath), { recursive: true });
    await fs.writeFile(paths.binaryPath, "binary-content", "utf8");

    const status = await inspectManagedInstallStatus({
      installRoot,
      version: "v0.1.0",
      target
    });

    assert.ok(status);
    assert.equal(status.exists, true);
    assert.equal(status.version, "0.1.0");
    assert.equal(status.binaryPath, paths.binaryPath);
  });
});

test("inspectManagedInstallStatus reports missing binary when file does not exist", async () => {
  await withTempDir(async (installRoot) => {
    const target = detectManagedInstallTarget("linux", "x64");
    assert.ok(target);

    const status = await inspectManagedInstallStatus({
      installRoot,
      version: "v0.1.0",
      target
    });

    assert.ok(status);
    assert.equal(status.exists, false);
    assert.equal(status.version, "0.1.0");
  });
});

test("inspectManagedInstallStatus loads persisted failure from disk", async () => {
  await withTempDir(async (storageRoot) => {
    clearManagedInstallFailure();

    await persistManagedInstallFailure({
      stage: "extract",
      reason: "extract-failed",
      message: "Archive corrupted."
    }, { storageRoot });
    clearManagedInstallFailure();

    const target = detectManagedInstallTarget("darwin", "arm64");
    assert.ok(target);

    const status = await inspectManagedInstallStatus({
      installRoot: storageRoot,
      version: "v0.1.0",
      target,
      failurePersistence: { storageRoot }
    });

    assert.ok(status);
    assert.equal(status.failure?.stage, "extract");
    assert.equal(status.failure?.reason, "extract-failed");
    assert.match(status.failure?.message ?? "", /Archive corrupted/);
  });
});

test("promoteManagedInstallBinary clears persisted failure on disk after success", async () => {
  await withTempDir(async (installRoot) => {
    const storageRoot = path.join(installRoot, "storage");
    const target = detectManagedInstallTarget("darwin", "arm64");
    assert.ok(target);

    await persistManagedInstallFailure({
      stage: "verify",
      reason: "checksum-mismatch",
      message: "Previous failure."
    }, { storageRoot });

    const failurePath = path.join(storageRoot, "managed-install-failure.json");
    assert.equal(await fileExists(failurePath), true, "failure file should exist before promotion");

    const paths = resolveManagedInstallTransactionPaths(installRoot, "0.1.0", target);
    await fs.mkdir(path.dirname(paths.stagedBinaryPath), { recursive: true });
    await fs.writeFile(paths.stagedBinaryPath, "new-binary", "utf8");

    await promoteManagedInstallBinary({
      paths,
      failurePersistence: { storageRoot }
    });

    assert.equal(await fileExists(failurePath), false, "failure file should be cleared after successful promotion");
  });
});

test("loadManagedInstallFailure returns undefined for corrupted JSON on disk", async () => {
  await withTempDir(async (storageRoot) => {
    clearManagedInstallFailure();
    const failurePath = path.join(storageRoot, "managed-install-failure.json");
    await fs.writeFile(failurePath, "not valid json {{{", "utf8");

    const loaded = await loadManagedInstallFailure({ storageRoot });
    assert.equal(loaded, undefined, "corrupted JSON should return undefined");
  });
});

test("loadManagedInstallFailure returns undefined for valid JSON with wrong shape", async () => {
  await withTempDir(async (storageRoot) => {
    clearManagedInstallFailure();
    const failurePath = path.join(storageRoot, "managed-install-failure.json");
    await fs.writeFile(failurePath, JSON.stringify({ unrelated: "data" }), "utf8");

    const loaded = await loadManagedInstallFailure({ storageRoot });
    assert.equal(loaded, undefined, "valid JSON with wrong shape should return undefined");
  });
});
