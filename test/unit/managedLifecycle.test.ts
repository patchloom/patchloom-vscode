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
  extractManagedInstallArchive,
  fetchLatestReleaseVersion,
  inspectManagedInstallStatus,
  loadManagedInstallFailure,
  performManagedInstall,
  persistManagedInstallFailure,
  promoteManagedInstallBinary,
  resolveManagedInstallTransactionPaths,
  type ManagedInstallFailure,
  type ManagedInstallStage
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
    const paths = resolveManagedInstallTransactionPaths(installRoot, target);

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
    const paths = resolveManagedInstallTransactionPaths(installRoot, target);

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
    const paths = resolveManagedInstallTransactionPaths(installRoot, target);

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
    const paths = resolveManagedInstallTransactionPaths(installRoot, target);

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
    const paths = resolveManagedInstallTransactionPaths(installRoot, target);

    await fs.mkdir(path.dirname(paths.binaryPath), { recursive: true });
    await fs.writeFile(paths.binaryPath, "binary-content", "utf8");

    const status = await inspectManagedInstallStatus({
      installRoot,
      target
    });

    assert.ok(status);
    assert.equal(status.exists, true);
    assert.equal(status.binaryPath, paths.binaryPath);
  });
});

test("inspectManagedInstallStatus reports missing binary when file does not exist", async () => {
  await withTempDir(async (installRoot) => {
    const target = detectManagedInstallTarget("linux", "x64");
    assert.ok(target);

    const status = await inspectManagedInstallStatus({
      installRoot,
      target
    });

    assert.ok(status);
    assert.equal(status.exists, false);
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

    const paths = resolveManagedInstallTransactionPaths(installRoot, target);
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

// --- fetchLatestReleaseVersion tests ---

test("fetchLatestReleaseVersion extracts version from GitHub API response", async () => {
  const version = await fetchLatestReleaseVersion({
    fetchJson: async () => ({ tag_name: "v0.2.0" })
  });
  assert.equal(version, "0.2.0");
});

test("fetchLatestReleaseVersion strips leading v from tag", async () => {
  const version = await fetchLatestReleaseVersion({
    fetchJson: async () => ({ tag_name: "v1.0.0-beta.1" })
  });
  assert.equal(version, "1.0.0-beta.1");
});

test("fetchLatestReleaseVersion throws on missing tag_name", async () => {
  await assert.rejects(
    () => fetchLatestReleaseVersion({
      fetchJson: async () => ({ tag_name: "" })
    }),
    /no tag_name/
  );
});

test("fetchLatestReleaseVersion throws on API failure", async () => {
  await assert.rejects(
    () => fetchLatestReleaseVersion({
      fetchJson: async () => { throw new Error("HTTP 503"); }
    }),
    /HTTP 503/
  );
});

// --- extractManagedInstallArchive tests ---

test("extractManagedInstallArchive invokes tar with correct arguments for tar.xz", async () => {
  const calls: { cmd: string; args: string[]; cwd: string }[] = [];
  await extractManagedInstallArchive({
    archivePath: "/tmp/archive.tar.xz",
    destDir: "/tmp/staging",
    format: ".tar.xz",
    ensureDir: async () => {},
    execCommand: async (cmd, args, cwd) => { calls.push({ cmd, args, cwd }); }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "tar");
  assert.deepEqual(calls[0].args, ["xf", "/tmp/archive.tar.xz", "-C", "/tmp/staging"]);
});

test("extractManagedInstallArchive invokes tar for zip format on Windows", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  await extractManagedInstallArchive({
    archivePath: "C:\\tmp\\archive.zip",
    destDir: "C:\\tmp\\staging",
    format: ".zip",
    ensureDir: async () => {},
    execCommand: async (cmd, args) => { calls.push({ cmd, args }); }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "tar");
  assert.ok(calls[0].args.includes("xf"));
});

// --- performManagedInstall tests ---

test("performManagedInstall runs full pipeline with injected I/O", async () => {
  await withTempDir(async (installRoot) => {
    const target = detectManagedInstallTarget("darwin", "arm64");
    assert.ok(target);

    const stages: ManagedInstallStage[] = [];
    // SHA-256 of "fake-archive-content"
    const checksumContent = "fd3d4b42292957ad0b649621615962140c857fbf7342038d6cc6b2b1ab8c3411  patchloom-aarch64-apple-darwin.tar.xz\n";

    const result = await performManagedInstall({
      installRoot,
      version: "0.1.0",
      platform: "darwin",
      arch: "arm64",
      onProgress: (stage) => { stages.push(stage); },
      downloadFile: async (inputs) => {
        await fs.mkdir(path.dirname(inputs.destPath), { recursive: true });
        if (inputs.url.endsWith(".sha256")) {
          await fs.writeFile(inputs.destPath, checksumContent, "utf8");
        } else {
          // Write archive content that matches the checksum
          await fs.writeFile(inputs.destPath, "fake-archive-content", "utf8");
        }
      },
      extractArchive: async (inputs) => {
        // Simulate extraction: create the binary in staging
        const txPaths = resolveManagedInstallTransactionPaths(installRoot, target);
        await fs.mkdir(path.dirname(txPaths.stagedBinaryPath), { recursive: true });
        await fs.writeFile(txPaths.stagedBinaryPath, "#!/bin/sh\necho patchloom 0.1.0\n", { mode: 0o755 });
      },
      readFileContent: async (filePath) => {
        return fs.readFile(filePath, "utf8");
      },
      failurePersistence: { storageRoot: installRoot }
    });

    assert.equal(result.version, "0.1.0");
    assert.ok(result.binaryPath.includes("managed-bin"));
    assert.equal(result.target.targetTriple, "aarch64-apple-darwin");

    // Verify progress stages were reported
    assert.ok(stages.includes("downloading-checksum"));
    assert.ok(stages.includes("downloading-archive"));
    assert.ok(stages.includes("extracting"));
    assert.ok(stages.includes("installing"));

    // Verify the binary was promoted to the live path
    const binaryContent = await fs.readFile(result.binaryPath, "utf8");
    assert.match(binaryContent, /patchloom 0\.1\.0/);
  });
});

test("performManagedInstall persists failure on checksum mismatch", async () => {
  await withTempDir(async (installRoot) => {
    const target = detectManagedInstallTarget("linux", "x64");
    assert.ok(target);
    clearManagedInstallFailure();

    // Checksum file says one hash, but archive content will produce a different hash
    const wrongChecksum = "0000000000000000000000000000000000000000000000000000000000000000  patchloom-x86_64-unknown-linux-gnu.tar.xz\n";

    await assert.rejects(
      () => performManagedInstall({
        installRoot,
        version: "0.1.0",
        platform: "linux",
        arch: "x64",
        downloadFile: async (inputs) => {
          await fs.mkdir(path.dirname(inputs.destPath), { recursive: true });
          if (inputs.url.endsWith(".sha256")) {
            await fs.writeFile(inputs.destPath, wrongChecksum, "utf8");
          } else {
            await fs.writeFile(inputs.destPath, "actual-archive-data", "utf8");
          }
        },
        readFileContent: async (filePath) => fs.readFile(filePath, "utf8"),
        failurePersistence: { storageRoot: installRoot }
      }),
      /Checksum mismatch/
    );

    const failure = await loadManagedInstallFailure({ storageRoot: installRoot });
    assert.ok(failure);
    assert.equal(failure.stage, "verify");
    assert.equal(failure.reason, "checksum-mismatch");
  });
});

test("performManagedInstall throws for unsupported platform", async () => {
  await assert.rejects(
    () => performManagedInstall({
      installRoot: "/tmp/fake",
      platform: "freebsd" as NodeJS.Platform,
      arch: "arm" as NodeJS.Architecture
    }),
    /Unsupported platform/
  );
});

test("performManagedInstall fetches latest version when none specified", async () => {
  await withTempDir(async (installRoot) => {
    const target = detectManagedInstallTarget("darwin", "arm64");
    assert.ok(target);

    // SHA-256 of "fake-archive"
    const checksumContent = "806166f1698bd2415adafa8e02c7c2a89d393a60978d0ac27efc9ec3265ab5c5  patchloom-aarch64-apple-darwin.tar.xz\n";

    const result = await performManagedInstall({
      installRoot,
      platform: "darwin",
      arch: "arm64",
      fetchLatestVersion: async () => "0.3.0",
      downloadFile: async (inputs) => {
        await fs.mkdir(path.dirname(inputs.destPath), { recursive: true });
        if (inputs.url.endsWith(".sha256")) {
          await fs.writeFile(inputs.destPath, checksumContent, "utf8");
        } else {
          await fs.writeFile(inputs.destPath, "fake-archive", "utf8");
        }
      },
      extractArchive: async (inputs) => {
        const txPaths = resolveManagedInstallTransactionPaths(installRoot, target);
        await fs.mkdir(path.dirname(txPaths.stagedBinaryPath), { recursive: true });
        await fs.writeFile(txPaths.stagedBinaryPath, "binary-0.3.0", { mode: 0o755 });
      },
      readFileContent: async (filePath) => fs.readFile(filePath, "utf8"),
      failurePersistence: { storageRoot: installRoot }
    });

    assert.equal(result.version, "0.3.0");
  });
});
