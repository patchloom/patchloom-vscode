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
  buildManagedInstallReleaseAssets,
  detectManagedInstallTarget,
  inspectManagedInstallStatus,
  normalizeReleaseVersion,
  PATCHLOOM_MANAGED_INSTALL_DIR,
  resolveManagedInstallPaths
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

test("managed install constants use a stable storage directory name", () => {
  assert.equal(PATCHLOOM_MANAGED_INSTALL_DIR, "patchloom-managed");
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
