import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  assessPatchloomCompatibility,
  comparePatchloomVersions,
  configuredBinaryPathFromSetting,
  describePatchloomCompatibility,
  describePatchloomSource,
  findOnPath,
  MINIMUM_SUPPORTED_PATCHLOOM_VERSION,
  patchloomNeedsUpgrade,
  parsePatchloomVersion,
  ensurePatchloomReadyOrNotify,
  preferredBinaryRemediationAction,
  resolvePatchloomStatusWithInputs,
  resolvePatchloomStatusWithSharedInflight,
  clearPatchloomStatusInflight,
  type PatchloomStatus
} from "../../src/binary/patchloom.js";
import {
  assertTrustedManagedInstallDownloadUrl,
  assertTrustedManagedInstallRedirectUrl,
  buildManagedInstallReleaseAssets,
  isTrustedManagedInstallDownloadUrl,
  isTrustedManagedInstallRedirectUrl,
  calculateSha256Hex,
  clearManagedInstallFailure,
  clearManagedInstallFailureRecord,
  detectManagedInstallTarget,
  inspectManagedInstallStatus,
  loadManagedInstallFailure,
  ManagedInstallVerificationError,
  normalizeReleaseVersion,
  parseManagedInstallChecksumFile,
  PATCHLOOM_MANAGED_INSTALL_DIR,
  PATCHLOOM_MANAGED_INSTALL_FAILURE_FILE,
  clearManagedInstallStaging,
  persistManagedInstallFailure,
  promoteManagedInstallBinary,
  resolveManagedInstallChecksum,
  resolveManagedInstallPaths,
  resolveManagedInstallRedirectUrl,
  resolveManagedInstallTransactionPaths,
  setManagedInstallFailure,
  isMuslLinux,
  verifyManagedInstallArchiveChecksum
} from "../../src/install/managed.js";
import { resolveMcpTargets } from "../../src/mcp/config.js";
import { defaultWorkspaceFolderIndex, describeWorkspaceEnvironment } from "../../src/workspace/readiness.js";

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

test("ensurePatchloomReadyOrNotify returns path for ready supported status (test inputs)", async () => {
  const path = await ensurePatchloomReadyOrNotify("", {
    configuredPath: "/good/patchloom",
    canExecute: async () => true,
    getVersion: async () => "patchloom 0.3.0"
  });
  assert.equal(path, "/good/patchloom");
});

test("preferredBinaryRemediationAction installs when CLI missing and managed available", () => {
  const action = preferredBinaryRemediationAction({
    ready: false,
    source: "missing",
    message: "Patchloom binary not found.",
    managedInstall: {
      exists: false,
      binaryPath: "/managed/managed-bin/patchloom",
      target: {
        platform: "darwin",
        arch: "arm64",
        targetTriple: "aarch64-apple-darwin",
        archiveFormat: ".tar.xz"
      }
    }
  });
  assert.deepEqual(action, {
    title: "Install Patchloom",
    command: "patchloom.installBinary"
  });
});

test("preferredBinaryRemediationAction reinstalls when managed binary present but not ready", () => {
  const action = preferredBinaryRemediationAction({
    ready: false,
    source: "managed",
    message: "Managed Patchloom binary is not executable.",
    managedInstall: {
      exists: true,
      binaryPath: "/managed/managed-bin/patchloom",
      target: {
        platform: "darwin",
        arch: "arm64",
        targetTriple: "aarch64-apple-darwin",
        archiveFormat: ".tar.xz"
      }
    }
  });
  assert.deepEqual(action, {
    title: "Reinstall Patchloom",
    command: "patchloom.reinstallBinary"
  });
});

test("preferredBinaryRemediationAction updates outdated managed install", () => {
  const action = preferredBinaryRemediationAction({
    ready: true,
    source: "managed",
    message: "Using managed Patchloom install.",
    binaryPath: "/managed/managed-bin/patchloom",
    version: "patchloom 0.0.9",
    detectedVersion: "0.0.9",
    compatibility: "unsupported",
    minimumSupportedVersion: MINIMUM_SUPPORTED_PATCHLOOM_VERSION,
    compatibilityMessage: `Patchloom 0.0.9 is older than the minimum supported version ${MINIMUM_SUPPORTED_PATCHLOOM_VERSION}.`,
    managedInstall: {
      exists: true,
      binaryPath: "/managed/managed-bin/patchloom",
      target: {
        platform: "darwin",
        arch: "arm64",
        targetTriple: "aarch64-apple-darwin",
        archiveFormat: ".tar.xz"
      }
    }
  });
  assert.deepEqual(action, {
    title: "Update Patchloom",
    command: "patchloom.updateBinary"
  });
});

test("preferredBinaryRemediationAction opens releases for outdated PATH even when managed exists", () => {
  // PATH wins resolution over managed; updating managed would not change the active binary.
  const action = preferredBinaryRemediationAction({
    ready: true,
    source: "path",
    message: "Using Patchloom from PATH.",
    binaryPath: "/usr/local/bin/patchloom",
    version: "patchloom 0.0.9",
    detectedVersion: "0.0.9",
    compatibility: "unsupported",
    minimumSupportedVersion: MINIMUM_SUPPORTED_PATCHLOOM_VERSION,
    compatibilityMessage: `Patchloom 0.0.9 is older than the minimum supported version ${MINIMUM_SUPPORTED_PATCHLOOM_VERSION}.`,
    managedInstall: {
      exists: true,
      binaryPath: "/managed/managed-bin/patchloom",
      target: {
        platform: "darwin",
        arch: "arm64",
        targetTriple: "aarch64-apple-darwin",
        archiveFormat: ".tar.xz"
      }
    }
  });
  assert.deepEqual(action, {
    title: "Open Releases",
    command: "patchloom.openPatchloomReleases"
  });
});

test("preferredBinaryRemediationAction opens settings for outdated patchloom.path", () => {
  const action = preferredBinaryRemediationAction({
    ready: true,
    source: "setting",
    message: "Using Patchloom from patchloom.path.",
    binaryPath: "/custom/old/patchloom",
    version: "patchloom 0.0.9",
    detectedVersion: "0.0.9",
    compatibility: "unsupported",
    minimumSupportedVersion: MINIMUM_SUPPORTED_PATCHLOOM_VERSION,
    compatibilityMessage: `Patchloom 0.0.9 is older than the minimum supported version ${MINIMUM_SUPPORTED_PATCHLOOM_VERSION}.`
  });
  assert.deepEqual(action, {
    title: "Open Settings",
    command: "patchloom.openPatchloomSettings"
  });
});

test("preferredBinaryRemediationAction opens settings when no managed path exists", () => {
  const action = preferredBinaryRemediationAction({
    ready: false,
    source: "missing",
    message: "Patchloom binary not found."
  });
  assert.deepEqual(action, {
    title: "Open Settings",
    command: "patchloom.openPatchloomSettings"
  });
});

test("preferredBinaryRemediationAction is undefined when ready and supported", () => {
  const action = preferredBinaryRemediationAction({
    ready: true,
    source: "path",
    message: "Using Patchloom from PATH.",
    binaryPath: "/usr/local/bin/patchloom",
    version: "patchloom 0.31.0",
    detectedVersion: "0.31.0",
    compatibility: "supported",
    minimumSupportedVersion: MINIMUM_SUPPORTED_PATCHLOOM_VERSION
  });
  assert.equal(action, undefined);
});

// Note: ensurePatchloomReadyOrNotify UI branches call vscode.window.show* which is
// not unit-testable in pure node. Remediation selection is covered above.

test("defaultWorkspaceFolderIndex prefers active folders and only auto-selects single roots", () => {
  assert.equal(defaultWorkspaceFolderIndex(3, 2), 2);
  assert.equal(defaultWorkspaceFolderIndex(1, undefined), 0);
  assert.equal(defaultWorkspaceFolderIndex(2, undefined), undefined);
});

test("defaultWorkspaceFolderIndex ignores out-of-range active indices", () => {
  assert.equal(defaultWorkspaceFolderIndex(3, -1), undefined);
  assert.equal(defaultWorkspaceFolderIndex(3, 3), undefined);
  assert.equal(defaultWorkspaceFolderIndex(3, 99), undefined);
  assert.equal(defaultWorkspaceFolderIndex(0, 0), undefined);
});

test("describeWorkspaceEnvironment reports local environment for undefined remoteName", () => {
  const environment = describeWorkspaceEnvironment(undefined);

  assert.equal(environment.label, "Local");
  assert.equal(environment.support, "supported");
  assert.equal(environment.supportsUserMcpConfig, true);
  assert.equal(environment.remoteName, undefined);
  assert.equal(environment.note, undefined);
});

test("describeWorkspaceEnvironment reports limited remote support", () => {
  const environment = describeWorkspaceEnvironment("wsl");

  assert.equal(environment.label, "WSL");
  assert.equal(environment.support, "limited");
  assert.equal(environment.supportsUserMcpConfig, false);
  assert.match(environment.note ?? "", /workspace-scoped/i);
});

test("describeWorkspaceEnvironment reports limited support for ssh-remote", () => {
  const environment = describeWorkspaceEnvironment("ssh-remote");

  assert.equal(environment.label, "Remote SSH");
  assert.equal(environment.support, "limited");
  assert.equal(environment.supportsUserMcpConfig, false);
});

test("describeWorkspaceEnvironment reports limited support for dev-container", () => {
  const environment = describeWorkspaceEnvironment("dev-container");

  assert.equal(environment.label, "Dev Container");
  assert.equal(environment.support, "limited");
  assert.equal(environment.supportsUserMcpConfig, false);
});

test("describeWorkspaceEnvironment reports limited support for codespaces", () => {
  const environment = describeWorkspaceEnvironment("codespaces");

  assert.equal(environment.label, "Codespaces");
  assert.equal(environment.support, "limited");
  assert.equal(environment.supportsUserMcpConfig, false);
});

test("describeWorkspaceEnvironment reports unverified for unknown remote names", () => {
  const environment = describeWorkspaceEnvironment("some-unknown-remote");

  assert.equal(environment.label, "Remote (some-unknown-remote)");
  assert.equal(environment.support, "unverified");
  assert.equal(environment.supportsUserMcpConfig, false);
  assert.match(environment.note ?? "", /not explicitly verified/i);
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
  assert.deepEqual(detectManagedInstallTarget("win32", "arm64"), {
    platform: "win32",
    arch: "arm64",
    targetTriple: "aarch64-pc-windows-msvc",
    archiveFormat: ".zip"
  });
  assert.equal(detectManagedInstallTarget("linux", "arm"), undefined);
});

test("detectManagedInstallTarget selects musl target when isMusl is true", () => {
  assert.deepEqual(detectManagedInstallTarget("linux", "x64", true), {
    platform: "linux",
    arch: "x64",
    targetTriple: "x86_64-unknown-linux-musl",
    archiveFormat: ".tar.xz"
  });
  assert.deepEqual(detectManagedInstallTarget("linux", "arm64", true), {
    platform: "linux",
    arch: "arm64",
    targetTriple: "aarch64-unknown-linux-musl",
    archiveFormat: ".tar.xz"
  });
});

test("detectManagedInstallTarget selects gnu target when isMusl is false", () => {
  assert.deepEqual(detectManagedInstallTarget("linux", "x64", false), {
    platform: "linux",
    arch: "x64",
    targetTriple: "x86_64-unknown-linux-gnu",
    archiveFormat: ".tar.xz"
  });
  assert.deepEqual(detectManagedInstallTarget("linux", "arm64", false), {
    platform: "linux",
    arch: "arm64",
    targetTriple: "aarch64-unknown-linux-gnu",
    archiveFormat: ".tar.xz"
  });
});

test("detectManagedInstallTarget ignores isMusl for non-Linux platforms", () => {
  const darwinTarget = detectManagedInstallTarget("darwin", "arm64", true);
  assert.equal(darwinTarget?.targetTriple, "aarch64-apple-darwin");
  const windowsTarget = detectManagedInstallTarget("win32", "x64", true);
  assert.equal(windowsTarget?.targetTriple, "x86_64-pc-windows-msvc");
});

test("isMuslLinux returns false on non-Linux platforms", () => {
  // On macOS/Windows (where CI runs), the musl linker does not exist
  if (process.platform !== "linux") {
    assert.equal(isMuslLinux("x64"), false);
    assert.equal(isMuslLinux("arm64"), false);
  }
});

test("isMuslLinux returns false for unsupported architectures", () => {
  assert.equal(isMuslLinux("arm" as NodeJS.Architecture), false);
  assert.equal(isMuslLinux("ia32" as NodeJS.Architecture), false);
});

test("resolveManagedInstallPaths uses cargo-dist style archive names", () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  const paths = resolveManagedInstallPaths("/managed/install", target);

  assert.equal(paths.archiveFileName, "patchloom-aarch64-apple-darwin.tar.xz");
  assert.equal(paths.checksumFileName, "patchloom-aarch64-apple-darwin.tar.xz.sha256");
  assert.equal(paths.binaryPath, path.join("/managed/install", "managed-bin", "patchloom"));
});

test("buildManagedInstallReleaseAssets builds archive and checksum urls with patchloom-v tag", () => {
  const target = detectManagedInstallTarget("linux", "x64");
  assert.ok(target);
  const release = buildManagedInstallReleaseAssets("v0.1.0", target);

  assert.equal(release.tagName, "patchloom-v0.1.0");
  assert.equal(release.archiveFileName, "patchloom-x86_64-unknown-linux-gnu.tar.xz");
  assert.equal(release.checksumFileName, "patchloom-x86_64-unknown-linux-gnu.tar.xz.sha256");
  assert.match(release.archiveDownloadUrl, /\/patchloom-v0\.1\.0\/patchloom-x86_64-unknown-linux-gnu\.tar\.xz$/);
  assert.match(release.checksumDownloadUrl, /\/patchloom-v0\.1\.0\/patchloom-x86_64-unknown-linux-gnu\.tar\.xz\.sha256$/);
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

test("assertTrustedManagedInstallDownloadUrl only accepts GitHub release download URLs", () => {
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
  const paths = resolveManagedInstallTransactionPaths("/managed/install", target);

  assert.equal(paths.archivePath, path.join("/managed/install", "patchloom-aarch64-apple-darwin.tar.xz"));
  assert.equal(paths.stagedArchivePath, path.join("/managed/install", ".staging", "patchloom-aarch64-apple-darwin.tar.xz"));
  assert.equal(paths.stagedChecksumPath, path.join("/managed/install", ".staging", "patchloom-aarch64-apple-darwin.tar.xz.sha256"));
  assert.equal(paths.stagedBinaryPath, path.join("/managed/install", ".staging", "managed-bin", "patchloom"));
  assert.equal(paths.backupBinaryPath, `${path.join("/managed/install", "managed-bin", "patchloom")}.bak`);
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
      target,
      fileExists: async () => false
    });

    assert.deepEqual(status, {
      exists: false,
      binaryPath: path.join("/managed/install", "managed-bin", "patchloom"),
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

test("clearManagedInstallStaging removes the entire staging directory", async () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  const paths = resolveManagedInstallTransactionPaths("/managed/install", target);
  const operations: string[] = [];

  await clearManagedInstallStaging({
    paths,
    removeDir: async (dirPath) => {
      operations.push(`rmdir ${dirPath}`);
    }
  });

  assert.deepEqual(operations, [
    `rmdir ${paths.stagingRoot}`
  ]);
});

test("promoteManagedInstallBinary replaces the live binary and clears stale backups", async () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  const paths = resolveManagedInstallTransactionPaths("/managed/install", target);
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
    },
    failurePersistence: {
      storageRoot: "/managed/storage",
      removeFile: async (filePath) => {
        operations.push(`remove ${filePath}`);
      }
    }
  });

  assert.deepEqual(operations, [
    `mkdir ${path.dirname(paths.binaryPath)}`,
    `remove ${paths.backupBinaryPath}`,
    `rename ${paths.binaryPath} -> ${paths.backupBinaryPath}`,
    `rename ${paths.stagedBinaryPath} -> ${paths.binaryPath}`,
    `remove ${paths.backupBinaryPath}`,
    `remove ${path.join("/managed/storage", PATCHLOOM_MANAGED_INSTALL_FAILURE_FILE)}`
  ]);

  const status = await inspectManagedInstallStatus({
    installRoot: "/managed/install",
    target,
    fileExists: async (filePath) => existing.has(filePath)
  });
  assert.equal(status?.exists, true);
  assert.equal(status?.failure, undefined);
});

test("promoteManagedInstallBinary restores the previous binary when replacement fails", async () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  const paths = resolveManagedInstallTransactionPaths("/managed/install", target);
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
      },
      failurePersistence: {
        storageRoot: "/managed/storage",
        ensureDir: async (dirPath) => {
          operations.push(`mkdir ${dirPath}`);
        },
        writeFile: async (filePath, content) => {
          operations.push(`write ${filePath} => ${content.trim()}`);
        }
      }
    }),
    /Failed to replace managed Patchloom binary/
  );

  try {
    const failurePath = path.join("/managed/storage", PATCHLOOM_MANAGED_INSTALL_FAILURE_FILE);
    assert.deepEqual(operations, [
      `mkdir ${path.dirname(paths.binaryPath)}`,
      `rename ${paths.binaryPath} -> ${paths.backupBinaryPath}`,
      `rename ${paths.stagedBinaryPath} -> ${paths.binaryPath}`,
      `rename ${paths.backupBinaryPath} -> ${paths.binaryPath}`,
      `mkdir ${path.dirname(failurePath)}`,
      `write ${failurePath} => {\n  \"stage\": \"replace\",\n  \"reason\": \"replace-failed\",\n  \"message\": \"Failed to replace managed Patchloom binary (simulated rename failure).\"\n}`
    ]);

    const status = await inspectManagedInstallStatus({
      installRoot: "/managed/install",
      target,
      fileExists: async (filePath) => existing.has(filePath)
    });
    assert.equal(status?.exists, true);
    assert.deepEqual(status?.failure, {
      stage: "replace",
      reason: "replace-failed",
      message: "Failed to replace managed Patchloom binary (simulated rename failure)."
    });
  } finally {
    clearManagedInstallFailure();
  }
});

test("inspectManagedInstallStatus reports discovered managed binaries", async () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  const expectedBinaryPath = path.join("/managed/install", "managed-bin", "patchloom");
  const status = await inspectManagedInstallStatus({
    installRoot: "/managed/install",
    target,
    fileExists: async (filePath) => filePath === expectedBinaryPath
  });

  assert.deepEqual(status, {
    exists: true,
    binaryPath: expectedBinaryPath,
    target
  });
});

test("loadManagedInstallFailure reads persisted failure diagnostics from storage", async () => {
  clearManagedInstallFailure();

  const failure = await loadManagedInstallFailure({
    storageRoot: "/managed/storage",
    readFile: async (filePath) => {
      assert.equal(filePath, path.join("/managed/storage", PATCHLOOM_MANAGED_INSTALL_FAILURE_FILE));
      return JSON.stringify({
        stage: "verify",
        reason: "checksum-mismatch",
        message: "Checksum mismatch for patchloom-aarch64-apple-darwin.tar.xz."
      });
    }
  });

  assert.deepEqual(failure, {
    stage: "verify",
    reason: "checksum-mismatch",
    message: "Checksum mismatch for patchloom-aarch64-apple-darwin.tar.xz."
  });
  clearManagedInstallFailure();
});

test("persistManagedInstallFailure and clearManagedInstallFailureRecord update the failure record file", async () => {
  const writes: string[] = [];

  await persistManagedInstallFailure({
    stage: "extract",
    reason: "extract-failed",
    message: "Archive extraction failed."
  }, {
    storageRoot: "/managed/storage",
    ensureDir: async (dirPath) => {
      writes.push(`mkdir ${dirPath}`);
    },
    writeFile: async (filePath, content) => {
      writes.push(`write ${filePath} => ${content.trim()}`);
    }
  });

  await clearManagedInstallFailureRecord({
    storageRoot: "/managed/storage",
    removeFile: async (filePath) => {
      writes.push(`remove ${filePath}`);
    }
  });

  const failurePath = path.join("/managed/storage", PATCHLOOM_MANAGED_INSTALL_FAILURE_FILE);
  assert.deepEqual(writes, [
    `mkdir ${path.dirname(failurePath)}`,
    `write ${failurePath} => {\n  \"stage\": \"extract\",\n  \"reason\": \"extract-failed\",\n  \"message\": \"Archive extraction failed.\"\n}`,
    `remove ${failurePath}`
  ]);
  assert.equal(await loadManagedInstallFailure({}), undefined);
});

test("resolvePatchloomStatusWithInputs surfaces persisted managed install failures after reload", async () => {
  clearManagedInstallFailure();
  const storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "patchloom-managed-"));

  try {
    await persistManagedInstallFailure({
      stage: "verify",
      reason: "checksum-mismatch",
      message: "Checksum mismatch for patchloom-aarch64-apple-darwin.tar.xz."
    }, {
      storageRoot
    });
    clearManagedInstallFailure();

    const status = await resolvePatchloomStatusWithInputs({
      configuredPath: "",
      pathValue: "/usr/local/bin:/bin",
      platform: "darwin",
      arch: "arm64",
      managedInstallRoot: storageRoot,
      managedFileExists: async () => false,
      canExecute: async () => false,
      getVersion: async () => undefined
    });

    assert.equal(status.ready, false);
    assert.equal(status.source, "missing");
    assert.deepEqual(status.managedInstall?.failure, {
      stage: "verify",
      reason: "checksum-mismatch",
      message: "Checksum mismatch for patchloom-aarch64-apple-darwin.tar.xz."
    });
    assert.deepEqual(status.diagnostics, [
      "Managed install last failure stage: verify",
      "Managed install last failure reason: checksum-mismatch",
      "Managed install diagnostic: Checksum mismatch for patchloom-aarch64-apple-darwin.tar.xz."
    ]);
  } finally {
    clearManagedInstallFailure();
    await fs.rm(storageRoot, { recursive: true, force: true });
  }
});

test("normalizeReleaseVersion strips v and patchloom-v prefixes", () => {
  assert.equal(normalizeReleaseVersion("v0.1.0"), "0.1.0");
  assert.equal(normalizeReleaseVersion("0.1.0"), "0.1.0");
  assert.equal(normalizeReleaseVersion("patchloom-v0.1.2"), "0.1.2");
});

test("buildManagedInstallReleaseAssets normalizes patchloom-v prefixed versions", () => {
  const target = detectManagedInstallTarget("darwin", "arm64");
  assert.ok(target);
  const release = buildManagedInstallReleaseAssets("patchloom-v0.1.2", target);

  assert.equal(release.tagName, "patchloom-v0.1.2");
  assert.match(release.archiveDownloadUrl, /\/patchloom-v0\.1\.2\/patchloom-aarch64-apple-darwin\.tar\.xz$/);
});

test("resolvePatchloomStatusWithInputs falls back to a managed install when present", async () => {
  const expectedBinaryPath = path.join("/managed/install", "managed-bin", "patchloom");
  const status = await resolvePatchloomStatusWithInputs({
    configuredPath: "",
    pathValue: "/usr/local/bin:/bin",
    platform: "darwin",
    arch: "arm64",
    managedInstallRoot: "/managed/install",
    managedFileExists: async (filePath) => filePath === expectedBinaryPath,
    canExecute: async (candidate) => candidate === expectedBinaryPath,
    getVersion: async () => "patchloom 0.1.0"
  });

  assert.equal(status.ready, true);
  assert.equal(status.source, "managed");
  assert.equal(status.binaryPath, expectedBinaryPath);
  assert.equal(status.managedInstall?.exists, true);
});

test("configuredBinaryPathFromSetting trims whitespace and returns undefined for empty values", () => {
  assert.equal(configuredBinaryPathFromSetting("/usr/local/bin/patchloom"), "/usr/local/bin/patchloom");
  assert.equal(configuredBinaryPathFromSetting("  /custom/patchloom  "), "/custom/patchloom");
  assert.equal(configuredBinaryPathFromSetting(""), undefined);
  assert.equal(configuredBinaryPathFromSetting("   "), undefined);
  assert.equal(configuredBinaryPathFromSetting(undefined), undefined);
});

test("describePatchloomSource maps all source types to labels", () => {
  assert.equal(describePatchloomSource("setting"), "patchloom.path");
  assert.equal(describePatchloomSource("path"), "PATH");
  assert.equal(describePatchloomSource("managed"), "managed install");
  assert.equal(describePatchloomSource("missing"), "not found");
});

test("describePatchloomCompatibility maps all compatibility levels to labels", () => {
  assert.equal(describePatchloomCompatibility("supported"), "supported");
  assert.equal(describePatchloomCompatibility("unsupported"), "upgrade required");
  assert.equal(describePatchloomCompatibility("unknown"), "unable to verify");
  assert.equal(describePatchloomCompatibility(undefined), "unknown");
});

// --- patchloomNeedsUpgrade tests ---

test("patchloomNeedsUpgrade returns true only for unsupported compatibility", () => {
  const base = { ready: false, source: "missing" as const, message: "test" };
  assert.equal(patchloomNeedsUpgrade({ ...base, compatibility: "unsupported" }), true);
  assert.equal(patchloomNeedsUpgrade({ ...base, compatibility: "supported" }), false);
  assert.equal(patchloomNeedsUpgrade({ ...base, compatibility: "unknown" }), false);
  assert.equal(patchloomNeedsUpgrade({ ...base, compatibility: undefined }), false);
});

// --- isTrustedManagedInstallDownloadUrl tests ---

test("isTrustedManagedInstallDownloadUrl accepts valid GitHub release URLs", () => {
  assert.equal(
    isTrustedManagedInstallDownloadUrl("https://github.com/patchloom/patchloom/releases/download/v0.1.0/archive.tar.xz"),
    true
  );
  assert.equal(
    isTrustedManagedInstallDownloadUrl("https://github.com/patchloom/patchloom/releases/download/v1.2.3/patchloom-x86_64.zip"),
    true
  );
});

test("isTrustedManagedInstallDownloadUrl rejects protocol-relative and non-HTTPS URLs", () => {
  assert.equal(
    isTrustedManagedInstallDownloadUrl("http://github.com/patchloom/patchloom/releases/download/v0.1.0/x"),
    false
  );
  assert.equal(
    isTrustedManagedInstallDownloadUrl("//github.com/patchloom/patchloom/releases/download/v0.1.0/x"),
    false
  );
});

test("isTrustedManagedInstallDownloadUrl handles query strings, fragments, and encoded paths", () => {
  assert.equal(
    isTrustedManagedInstallDownloadUrl(
      "https://github.com/patchloom/patchloom/releases/download/v1.2.3/patchloom-x86_64.zip?version=1.0"
    ),
    true
  );
  assert.equal(
    isTrustedManagedInstallDownloadUrl(
      "https://github.com/patchloom/patchloom/releases/download/v1.2.3/patchloom-x86_64.zip#sha256"
    ),
    true
  );
});

test("isTrustedManagedInstallDownloadUrl rejects non-GitHub hosts", () => {
  assert.equal(
    isTrustedManagedInstallDownloadUrl("https://evil.com/patchloom/patchloom/releases/download/v0.1.0/x"),
    false
  );
});

test("isTrustedManagedInstallDownloadUrl rejects wrong repo path", () => {
  assert.equal(
    isTrustedManagedInstallDownloadUrl("https://github.com/other/repo/releases/download/v0.1.0/x"),
    false
  );
});

test("isTrustedManagedInstallDownloadUrl rejects malformed URLs", () => {
  assert.equal(isTrustedManagedInstallDownloadUrl("not-a-url"), false);
  assert.equal(isTrustedManagedInstallDownloadUrl(""), false);
});

test("isTrustedManagedInstallDownloadUrl respects custom repo parameter", () => {
  assert.equal(
    isTrustedManagedInstallDownloadUrl(
      "https://github.com/custom/repo/releases/download/v1.0.0/file.tar.xz",
      "custom/repo"
    ),
    true
  );
  assert.equal(
    isTrustedManagedInstallDownloadUrl(
      "https://github.com/patchloom/patchloom/releases/download/v1.0.0/file.tar.xz",
      "custom/repo"
    ),
    false
  );
});

// --- managed install redirect URL trust tests ---

test("resolveManagedInstallRedirectUrl resolves relative Location against current URL", () => {
  const resolved = resolveManagedInstallRedirectUrl(
    "https://github.com/patchloom/patchloom/releases/download/v0.1.0/archive.tar.xz",
    "/foo"
  );
  assert.equal(resolved, "https://github.com/foo");
  assert.equal(isTrustedManagedInstallRedirectUrl(resolved), true);
});

test("isTrustedManagedInstallRedirectUrl accepts GitHub release CDN hosts over HTTPS", () => {
  assert.equal(
    isTrustedManagedInstallRedirectUrl("https://objects.githubusercontent.com/github-production-release-asset/x"),
    true
  );
  assert.equal(
    isTrustedManagedInstallRedirectUrl("https://release-assets.githubusercontent.com/x"),
    true
  );
  assert.equal(
    isTrustedManagedInstallRedirectUrl("https://github-releases.githubusercontent.com/x"),
    true
  );
  assert.equal(
    isTrustedManagedInstallRedirectUrl("https://github.com/patchloom/patchloom/releases/download/v0.1.0/x"),
    true
  );
});

test("isTrustedManagedInstallRedirectUrl rejects non-HTTPS and untrusted hosts", () => {
  assert.equal(
    isTrustedManagedInstallRedirectUrl("https://evil.example/payload"),
    false
  );
  assert.equal(
    isTrustedManagedInstallRedirectUrl("http://objects.githubusercontent.com/x"),
    false
  );
  assert.equal(
    isTrustedManagedInstallRedirectUrl("http://github.com/x"),
    false
  );
  assert.equal(isTrustedManagedInstallRedirectUrl("not-a-url"), false);
  assert.equal(isTrustedManagedInstallRedirectUrl(""), false);
});

test("assertTrustedManagedInstallRedirectUrl throws untrusted-download-url for evil hosts", () => {
  assert.doesNotThrow(() =>
    assertTrustedManagedInstallRedirectUrl("https://objects.githubusercontent.com/x")
  );
  assert.throws(
    () => assertTrustedManagedInstallRedirectUrl("https://evil.example/payload"),
    (error: unknown) => {
      assert.ok(error instanceof ManagedInstallVerificationError);
      assert.equal(error.reason, "untrusted-download-url");
      return true;
    }
  );
  assert.throws(
    () => assertTrustedManagedInstallRedirectUrl("http://objects.githubusercontent.com/x"),
    (error: unknown) => {
      assert.ok(error instanceof ManagedInstallVerificationError);
      assert.equal(error.reason, "untrusted-download-url");
      return true;
    }
  );
});

test("resolvePatchloomStatusWithInputs skips PATH and setting in untrusted workspaces", async () => {
  const expectedBinaryPath = path.join("/managed/install", "managed-bin", "patchloom");
  const status = await resolvePatchloomStatusWithInputs({
    configuredPath: "/evil/patchloom",
    pathValue: "/evil/bin:/usr/local/bin",
    platform: "darwin",
    arch: "arm64",
    managedInstallRoot: "/managed/install",
    managedFileExists: async (filePath) => filePath === expectedBinaryPath,
    canExecute: async (candidate) => candidate === expectedBinaryPath || candidate === "/evil/patchloom",
    getVersion: async () => "patchloom 0.1.5",
    isTrusted: false
  });

  assert.equal(status.ready, true);
  assert.equal(status.source, "managed");
  assert.equal(status.binaryPath, expectedBinaryPath);
});

test("resolvePatchloomStatusWithInputs reports restricted message when untrusted and no managed install", async () => {
  const status = await resolvePatchloomStatusWithInputs({
    configuredPath: "/evil/patchloom",
    pathValue: "/evil/bin",
    canExecute: async () => true,
    getVersion: async () => "patchloom 0.1.5",
    isTrusted: false
  });

  assert.equal(status.ready, false);
  assert.equal(status.source, "missing");
  assert.ok(status.message.includes("untrusted"));
});

test("resolvePatchloomStatusWithSharedInflight coalesces concurrent probes", async () => {
  clearPatchloomStatusInflight();
  let calls = 0;
  const status: PatchloomStatus = {
    ready: true,
    source: "path",
    message: "ok",
    binaryPath: "/bin/patchloom"
  };
  const resolve = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 20));
    return status;
  };

  const [a, b, c] = await Promise.all([
    resolvePatchloomStatusWithSharedInflight(resolve),
    resolvePatchloomStatusWithSharedInflight(resolve),
    resolvePatchloomStatusWithSharedInflight(resolve)
  ]);

  assert.equal(calls, 1);
  assert.equal(a, status);
  assert.equal(b, status);
  assert.equal(c, status);
  clearPatchloomStatusInflight();
});

test("resolvePatchloomStatusWithSharedInflight starts a new probe after the first finishes", async () => {
  clearPatchloomStatusInflight();
  let calls = 0;
  const resolve = async () => {
    calls += 1;
    return {
      ready: true,
      source: "path" as const,
      message: `call-${calls}`,
      binaryPath: "/bin/patchloom"
    };
  };

  const first = await resolvePatchloomStatusWithSharedInflight(resolve);
  const second = await resolvePatchloomStatusWithSharedInflight(resolve);

  assert.equal(calls, 2);
  assert.equal(first.message, "call-1");
  assert.equal(second.message, "call-2");
  clearPatchloomStatusInflight();
});

test("resolvePatchloomStatusWithSharedInflight retries after a failed probe", async () => {
  clearPatchloomStatusInflight();
  let calls = 0;
  const resolve = async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error("version failed");
    }
    return {
      ready: true,
      source: "path" as const,
      message: "ok",
      binaryPath: "/bin/patchloom"
    };
  };

  await assert.rejects(() => resolvePatchloomStatusWithSharedInflight(resolve), /version failed/);
  const recovered = await resolvePatchloomStatusWithSharedInflight(resolve);
  assert.equal(calls, 2);
  assert.equal(recovered.ready, true);
  clearPatchloomStatusInflight();
});

test("resolvePatchloomStatusWithInputs allows setting and PATH in trusted workspaces", async () => {
  const status = await resolvePatchloomStatusWithInputs({
    configuredPath: "/custom/patchloom",
    pathValue: "/usr/local/bin",
    canExecute: async (candidate) => candidate === "/custom/patchloom",
    getVersion: async () => "patchloom 0.1.5",
    isTrusted: true
  });

  assert.equal(status.ready, true);
  assert.equal(status.source, "setting");
});
