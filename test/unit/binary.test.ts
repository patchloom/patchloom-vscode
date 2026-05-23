import assert from "node:assert/strict";
import test from "node:test";
import {
  assessPatchloomCompatibility,
  comparePatchloomVersions,
  findOnPath,
  MINIMUM_SUPPORTED_PATCHLOOM_VERSION,
  parsePatchloomVersion,
  resolvePatchloomStatusWithInputs
} from "../../src/binary/patchloom";
import {
  assertTrustedManagedInstallDownloadUrl,
  buildManagedInstallReleaseAssets,
  calculateSha256Hex,
  clearManagedInstallFailure,
  detectManagedInstallTarget,
  inspectManagedInstallStatus,
  ManagedInstallVerificationError,
  normalizeReleaseVersion,
  parseManagedInstallChecksumFile,
  PATCHLOOM_MANAGED_INSTALL_DIR,
  promoteManagedInstallBinary,
  resolveManagedInstallChecksum,
  resolveManagedInstallPaths,
  resolveManagedInstallTransactionPaths,
  setManagedInstallFailure,
  verifyManagedInstallArchiveChecksum
} from "../../src/install/managed";
import { resolveMcpTargets } from "../../src/mcp/config";
import { defaultWorkspaceFolderIndex, describeWorkspaceEnvironment } from "../../src/workspace/readiness";

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

test("parsePatchloomVersion extracts semantic versions from --version output", () => {
  assert.equal(parsePatchloomVersion("patchloom 0.1.0"), "0.1.0");
  assert.equal(parsePatchloomVersion("patchloom v0.2.0-beta.1"), "0.2.0-beta.1");
  assert.equal(parsePatchloomVersion("custom build"), undefined);
});

test("comparePatchloomVersions follows semantic version ordering", () => {
  assert.ok(comparePatchloomVersions("0.1.0", "0.1.0") === 0);
  assert.ok(comparePatchloomVersions("0.2.0", "0.1.0") > 0);
  assert.ok(comparePatchloomVersions("0.1.0-beta.1", "0.1.0") < 0);
});

test("assessPatchloomCompatibility flags outdated CLI builds", () => {
  const assessment = assessPatchloomCompatibility("patchloom 0.0.9", MINIMUM_SUPPORTED_PATCHLOOM_VERSION);

  assert.equal(assessment.compatibility, "unsupported");
  assert.equal(assessment.detectedVersion, "0.0.9");
  assert.match(assessment.message, /older than the minimum supported version/i);
});

test("resolvePatchloomStatusWithInputs exposes compatibility diagnostics", async () => {
  const status = await resolvePatchloomStatusWithInputs({
    configuredPath: "/custom/patchloom",
    canExecute: async () => true,
    getVersion: async () => "patchloom 0.0.9"
  });

  assert.equal(status.ready, true);
  assert.equal(status.compatibility, "unsupported");
  assert.equal(status.minimumSupportedVersion, MINIMUM_SUPPORTED_PATCHLOOM_VERSION);
  assert.match(status.compatibilityMessage ?? "", /older than the minimum supported version/i);
});

test("defaultWorkspaceFolderIndex prefers active folders and only auto-selects single roots", () => {
  assert.equal(defaultWorkspaceFolderIndex(3, 2), 2);
  assert.equal(defaultWorkspaceFolderIndex(1, undefined), 0);
  assert.equal(defaultWorkspaceFolderIndex(2, undefined), undefined);
});

test("describeWorkspaceEnvironment reports limited remote support", () => {
  const environment = describeWorkspaceEnvironment("wsl");

  assert.equal(environment.label, "WSL");
  assert.equal(environment.support, "limited");
  assert.equal(environment.supportsUserMcpConfig, false);
  assert.match(environment.note ?? "", /workspace-scoped/i);
});

test("resolveMcpTargets omits user config targets when disabled", () => {
  const targets = resolveMcpTargets("/workspace/demo", "/Users/demo", false);

  assert.deepEqual(targets.map((target) => target.kind), ["vscode-workspace", "cursor-workspace"]);
});

test("detectManagedInstallTarget maps supported platforms to release targets", () => {
  assert.deepEqual(detectManagedInstallTarget("darwin", "arm64"), {
    platform: "darwin",
    arch: "arm64",
    targetTriple: "aarch64-apple-darwin",
    archiveFormat: ".tar.xz"
  });
  assert.deepEqual(detectManagedInstallTarget("win32", "x64"), {
    platform: "win32",
    arch: "x64",
    targetTriple: "x86_64-pc-windows-msvc",
    archiveFormat: ".zip"
  });
  assert.equal(detectManagedInstallTarget("linux", "arm"), undefined);
});

test("resolveManagedInstallPaths uses cargo-dist style archive names", () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  const paths = resolveManagedInstallPaths("/managed/install", "0.1.0", target);

  assert.equal(paths.archiveFileName, "patchloom-aarch64-apple-darwin.tar.xz");
  assert.equal(paths.checksumFileName, "patchloom-aarch64-apple-darwin.tar.xz.sha256");
  assert.match(paths.binaryPath, /managed-bin\/patchloom$/);
});

test("buildManagedInstallReleaseAssets builds archive and checksum urls", () => {
  const target = detectManagedInstallTarget("linux", "x64");
  assert.ok(target);
  const release = buildManagedInstallReleaseAssets("v0.1.0", target);

  assert.equal(release.tagName, "v0.1.0");
  assert.equal(release.archiveFileName, "patchloom-x86_64-unknown-linux-gnu.tar.xz");
  assert.equal(release.checksumFileName, "patchloom-x86_64-unknown-linux-gnu.tar.xz.sha256");
  assert.match(release.archiveDownloadUrl, /patchloom-x86_64-unknown-linux-gnu\.tar\.xz$/);
  assert.match(release.checksumDownloadUrl, /patchloom-x86_64-unknown-linux-gnu\.tar\.xz\.sha256$/);
});

test("parseManagedInstallChecksumFile accepts common sha256 sidecar formats", () => {
  const entries = parseManagedInstallChecksumFile([
    "ece89100861aa6d4c7e409f279777d1619f8d86e0f67f396fa9f3e4535eb2f0e  patchloom-aarch64-apple-darwin.tar.xz",
    "1dc508c14f9b3584c992c61dcf8d18d8d3a6770f33fff241038c1e9ea7b27a97 *patchloom-x86_64-unknown-linux-gnu.tar.xz"
  ].join("\n"));

  assert.deepEqual(entries, [
    {
      sha256: "ece89100861aa6d4c7e409f279777d1619f8d86e0f67f396fa9f3e4535eb2f0e",
      fileName: "patchloom-aarch64-apple-darwin.tar.xz"
    },
    {
      sha256: "1dc508c14f9b3584c992c61dcf8d18d8d3a6770f33fff241038c1e9ea7b27a97",
      fileName: "patchloom-x86_64-unknown-linux-gnu.tar.xz"
    }
  ]);
});

test("resolveManagedInstallChecksum returns the matching archive checksum", () => {
  const checksum = resolveManagedInstallChecksum(
    [
      "ece89100861aa6d4c7e409f279777d1619f8d86e0f67f396fa9f3e4535eb2f0e  patchloom-aarch64-apple-darwin.tar.xz",
      "1dc508c14f9b3584c992c61dcf8d18d8d3a6770f33fff241038c1e9ea7b27a97  patchloom-x86_64-unknown-linux-gnu.tar.xz"
    ].join("\n"),
    "patchloom-x86_64-unknown-linux-gnu.tar.xz"
  );

  assert.equal(checksum, "1dc508c14f9b3584c992c61dcf8d18d8d3a6770f33fff241038c1e9ea7b27a97");
});

test("verifyManagedInstallArchiveChecksum validates archive content against the checksum sidecar", () => {
  const checksum = verifyManagedInstallArchiveChecksum(
    "patchloom",
    "ece89100861aa6d4c7e409f279777d1619f8d86e0f67f396fa9f3e4535eb2f0e  patchloom-aarch64-apple-darwin.tar.xz",
    "patchloom-aarch64-apple-darwin.tar.xz"
  );

  assert.equal(checksum, calculateSha256Hex("patchloom"));
});

test("verifyManagedInstallArchiveChecksum rejects mismatched archive content", () => {
  assert.throws(
    () => verifyManagedInstallArchiveChecksum(
      "managed-install",
      "ece89100861aa6d4c7e409f279777d1619f8d86e0f67f396fa9f3e4535eb2f0e  patchloom-aarch64-apple-darwin.tar.xz",
      "patchloom-aarch64-apple-darwin.tar.xz"
    ),
    (error: unknown) => {
      assert.ok(error instanceof ManagedInstallVerificationError);
      assert.equal(error.reason, "checksum-mismatch");
      assert.match(error.message, /checksum mismatch/i);
      return true;
    }
  );
});

test("parseManagedInstallChecksumFile rejects invalid lines", () => {
  assert.throws(
    () => parseManagedInstallChecksumFile("not-a-checksum patchloom-aarch64-apple-darwin.tar.xz"),
    (error: unknown) => {
      assert.ok(error instanceof ManagedInstallVerificationError);
      assert.equal(error.reason, "invalid-checksum-format");
      return true;
    }
  );
});

test("assertTrustedManagedInstallDownloadUrl only accepts GitHub release download urls", () => {
  assert.doesNotThrow(() => assertTrustedManagedInstallDownloadUrl(
    "https://github.com/patchloom/patchloom/releases/download/v0.1.0/patchloom-aarch64-apple-darwin.tar.xz"
  ));

  assert.throws(
    () => assertTrustedManagedInstallDownloadUrl(
      "https://example.com/patchloom-aarch64-apple-darwin.tar.xz"
    ),
    (error: unknown) => {
      assert.ok(error instanceof ManagedInstallVerificationError);
      assert.equal(error.reason, "untrusted-download-url");
      return true;
    }
  );
});

test("managed install constants use a stable storage directory name", () => {
  assert.equal(PATCHLOOM_MANAGED_INSTALL_DIR, "patchloom-managed");
});

test("resolveManagedInstallTransactionPaths keeps staged files separate from the live binary", () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  const paths = resolveManagedInstallTransactionPaths("/managed/install", "0.1.0", target);

  assert.equal(paths.archivePath, "/managed/install/0.1.0/patchloom-aarch64-apple-darwin.tar.xz");
  assert.equal(paths.stagedArchivePath, "/managed/install/0.1.0/.staging/patchloom-aarch64-apple-darwin.tar.xz");
  assert.equal(paths.stagedChecksumPath, "/managed/install/0.1.0/.staging/patchloom-aarch64-apple-darwin.tar.xz.sha256");
  assert.equal(paths.stagedBinaryPath, "/managed/install/0.1.0/.staging/managed-bin/patchloom");
  assert.equal(paths.backupBinaryPath, "/managed/install/0.1.0/managed-bin/patchloom.bak");
});

test("inspectManagedInstallStatus includes the last managed install failure for diagnostics", async () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  setManagedInstallFailure({
    stage: "verify",
    reason: "checksum-mismatch",
    message: "Checksum mismatch for patchloom-aarch64-apple-darwin.tar.xz."
  });

  try {
    const status = await inspectManagedInstallStatus({
      installRoot: "/managed/install",
      version: "v0.1.0",
      target,
      fileExists: async () => false
    });

    assert.deepEqual(status, {
      exists: false,
      binaryPath: "/managed/install/0.1.0/managed-bin/patchloom",
      version: "0.1.0",
      target,
      failure: {
        stage: "verify",
        reason: "checksum-mismatch",
        message: "Checksum mismatch for patchloom-aarch64-apple-darwin.tar.xz."
      }
    });
  } finally {
    clearManagedInstallFailure();
  }
});

test("promoteManagedInstallBinary replaces the live binary and clears stale backups", async () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  const paths = resolveManagedInstallTransactionPaths("/managed/install", "0.1.0", target);
  const operations: string[] = [];
  const existing = new Set([
    paths.binaryPath,
    paths.stagedBinaryPath,
    paths.backupBinaryPath
  ]);

  await promoteManagedInstallBinary({
    paths,
    fileExists: async (filePath) => existing.has(filePath),
    ensureDir: async (dirPath) => {
      operations.push(`mkdir ${dirPath}`);
    },
    renameFile: async (from, to) => {
      operations.push(`rename ${from} -> ${to}`);
      existing.delete(from);
      existing.add(to);
    },
    removeFile: async (filePath) => {
      operations.push(`remove ${filePath}`);
      existing.delete(filePath);
    }
  });

  assert.deepEqual(operations, [
    "mkdir /managed/install/0.1.0/managed-bin",
    "remove /managed/install/0.1.0/managed-bin/patchloom.bak",
    "rename /managed/install/0.1.0/managed-bin/patchloom -> /managed/install/0.1.0/managed-bin/patchloom.bak",
    "rename /managed/install/0.1.0/.staging/managed-bin/patchloom -> /managed/install/0.1.0/managed-bin/patchloom",
    "remove /managed/install/0.1.0/managed-bin/patchloom.bak"
  ]);

  const status = await inspectManagedInstallStatus({
    installRoot: "/managed/install",
    version: "v0.1.0",
    target,
    fileExists: async (filePath) => existing.has(filePath)
  });
  assert.equal(status?.exists, true);
  assert.equal(status?.failure, undefined);
});

test("promoteManagedInstallBinary restores the previous binary when replacement fails", async () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  const paths = resolveManagedInstallTransactionPaths("/managed/install", "0.1.0", target);
  const operations: string[] = [];
  const existing = new Set([
    paths.binaryPath,
    paths.stagedBinaryPath
  ]);

  await assert.rejects(
    () => promoteManagedInstallBinary({
      paths,
      fileExists: async (filePath) => existing.has(filePath),
      ensureDir: async (dirPath) => {
        operations.push(`mkdir ${dirPath}`);
      },
      renameFile: async (from, to) => {
        operations.push(`rename ${from} -> ${to}`);
        if (from === paths.stagedBinaryPath && to === paths.binaryPath) {
          throw new Error("simulated rename failure");
        }
        existing.delete(from);
        existing.add(to);
      },
      removeFile: async (filePath) => {
        operations.push(`remove ${filePath}`);
        existing.delete(filePath);
      }
    }),
    /Failed to replace managed Patchloom binary/
  );

  assert.deepEqual(operations, [
    "mkdir /managed/install/0.1.0/managed-bin",
    "rename /managed/install/0.1.0/managed-bin/patchloom -> /managed/install/0.1.0/managed-bin/patchloom.bak",
    "rename /managed/install/0.1.0/.staging/managed-bin/patchloom -> /managed/install/0.1.0/managed-bin/patchloom",
    "rename /managed/install/0.1.0/managed-bin/patchloom.bak -> /managed/install/0.1.0/managed-bin/patchloom"
  ]);

  const status = await inspectManagedInstallStatus({
    installRoot: "/managed/install",
    version: "v0.1.0",
    target,
    fileExists: async (filePath) => existing.has(filePath)
  });
  assert.equal(status?.exists, true);
  assert.deepEqual(status?.failure, {
    stage: "replace",
    reason: "replace-failed",
    message: "Failed to replace managed Patchloom binary (simulated rename failure)."
  });

  clearManagedInstallFailure();
});

test("inspectManagedInstallStatus reports discovered managed binaries", async () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  const status = await inspectManagedInstallStatus({
    installRoot: "/managed/install",
    version: "v0.1.0",
    target,
    fileExists: async (filePath) => filePath.endsWith("/0.1.0/managed-bin/patchloom")
  });

  assert.deepEqual(status, {
    exists: true,
    binaryPath: "/managed/install/0.1.0/managed-bin/patchloom",
    version: "0.1.0",
    target
  });
});

test("normalizeReleaseVersion removes a leading v", () => {
  assert.equal(normalizeReleaseVersion("v0.1.0"), "0.1.0");
  assert.equal(normalizeReleaseVersion("0.1.0"), "0.1.0");
});

test("resolvePatchloomStatusWithInputs falls back to a managed install when present", async () => {
  const status = await resolvePatchloomStatusWithInputs({
    configuredPath: "",
    pathValue: "/usr/local/bin:/bin",
    platform: "darwin",
    arch: "arm64",
    managedInstallRoot: "/managed/install",
    managedInstallVersion: "0.1.0",
    managedFileExists: async (filePath) => filePath.endsWith("/0.1.0/managed-bin/patchloom"),
    canExecute: async (candidate) => candidate === "/managed/install/0.1.0/managed-bin/patchloom",
    getVersion: async () => "patchloom 0.1.0"
  });

  assert.equal(status.ready, true);
  assert.equal(status.source, "managed");
  assert.equal(status.binaryPath, "/managed/install/0.1.0/managed-bin/patchloom");
  assert.equal(status.managedInstall?.exists, true);
});
