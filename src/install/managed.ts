import { createHash } from "node:crypto";
import * as path from "node:path";
import { formatError } from "../util.js";

export const PATCHLOOM_RELEASE_REPO = "patchloom/patchloom";
export const PATCHLOOM_MANAGED_INSTALL_DIR = "patchloom-managed";
export const PATCHLOOM_MANAGED_BINARY_DIR = "managed-bin";
export const PATCHLOOM_MANAGED_BINARY_NAME = process.platform === "win32" ? "patchloom.exe" : "patchloom";
export const PATCHLOOM_MANAGED_INSTALL_FAILURE_FILE = "managed-install-failure.json";

let managedInstallRoot: string | undefined;
let managedInstallFailure: ManagedInstallFailure | undefined;

export type PatchloomArchiveFormat = ".tar.xz" | ".zip";
export type PatchloomTargetTriple =
  | "aarch64-apple-darwin"
  | "x86_64-apple-darwin"
  | "aarch64-unknown-linux-gnu"
  | "x86_64-unknown-linux-gnu"
  | "x86_64-pc-windows-msvc";

export interface ManagedInstallTarget {
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly targetTriple: PatchloomTargetTriple;
  readonly archiveFormat: PatchloomArchiveFormat;
}

export interface ManagedInstallPaths {
  readonly installRoot: string;
  readonly versionRoot: string;
  readonly archiveFileName: string;
  readonly archivePath: string;
  readonly checksumFileName: string;
  readonly checksumPath: string;
  readonly binaryPath: string;
}

export interface ManagedInstallTransactionPaths extends ManagedInstallPaths {
  readonly stagingRoot: string;
  readonly stagedArchivePath: string;
  readonly stagedChecksumPath: string;
  readonly stagedBinaryPath: string;
  readonly backupBinaryPath: string;
}

export interface ManagedInstallReleaseAssets {
  readonly tagName: string;
  readonly archiveFileName: string;
  readonly checksumFileName: string;
  readonly archiveDownloadUrl: string;
  readonly checksumDownloadUrl: string;
}

export interface ManagedInstallFailure {
  readonly stage: ManagedInstallFailureStage;
  readonly reason: ManagedInstallVerificationFailureReason | "download-failed" | "extract-failed" | "replace-failed";
  readonly message: string;
}

export interface ManagedInstallStatus {
  readonly exists: boolean;
  readonly binaryPath: string;
  readonly version?: string;
  readonly target: ManagedInstallTarget;
  readonly failure?: ManagedInstallFailure;
}

export interface ManagedInstallStatusInputs {
  readonly installRoot: string;
  readonly version?: string;
  readonly target?: ManagedInstallTarget;
  readonly fileExists?: (filePath: string) => Promise<boolean>;
  readonly failurePersistence?: ManagedInstallFailurePersistenceInputs;
}

export interface ManagedInstallPromotionInputs {
  readonly paths: ManagedInstallTransactionPaths;
  readonly fileExists?: (filePath: string) => Promise<boolean>;
  readonly ensureDir?: (dirPath: string) => Promise<void>;
  readonly renameFile?: (from: string, to: string) => Promise<void>;
  readonly removeFile?: (filePath: string) => Promise<void>;
  readonly failurePersistence?: ManagedInstallFailurePersistenceInputs;
}

export interface ManagedInstallStagingCleanupInputs {
  readonly paths: ManagedInstallTransactionPaths;
  readonly removeDir?: (dirPath: string) => Promise<void>;
}

export interface ManagedInstallFailurePersistenceInputs {
  readonly storageRoot?: string;
  readonly readFile?: (filePath: string) => Promise<string | undefined>;
  readonly writeFile?: (filePath: string, content: string) => Promise<void>;
  readonly removeFile?: (filePath: string) => Promise<void>;
  readonly ensureDir?: (dirPath: string) => Promise<void>;
}

export interface ManagedInstallChecksumEntry {
  readonly fileName: string;
  readonly sha256: string;
}

export type ManagedInstallVerificationFailureReason =
  | "missing-checksum"
  | "invalid-checksum-format"
  | "checksum-mismatch"
  | "untrusted-download-url";

export type ManagedInstallFailureStage =
  | "download"
  | "verify"
  | "extract"
  | "replace";

export class ManagedInstallVerificationError extends Error {
  readonly reason: ManagedInstallVerificationFailureReason;

  constructor(reason: ManagedInstallVerificationFailureReason, message: string) {
    super(message);
    this.name = "ManagedInstallVerificationError";
    this.reason = reason;
  }
}

export function setManagedInstallRoot(root: string | undefined): void {
  managedInstallRoot = root;
}

export function getManagedInstallRoot(): string | undefined {
  return managedInstallRoot;
}

export function setManagedInstallFailure(failure: ManagedInstallFailure | undefined): void {
  managedInstallFailure = failure;
}

export function getManagedInstallFailure(): ManagedInstallFailure | undefined {
  return managedInstallFailure;
}

export function clearManagedInstallFailure(): void {
  managedInstallFailure = undefined;
}

export async function loadManagedInstallFailure(
  inputs: ManagedInstallFailurePersistenceInputs = {}
): Promise<ManagedInstallFailure | undefined> {
  const failurePath = resolveManagedInstallFailurePath(inputs.storageRoot);
  if (!failurePath) {
    return managedInstallFailure;
  }

  const content = await (inputs.readFile ?? defaultReadFile)(failurePath);
  if (!content) {
    managedInstallFailure = undefined;
    return undefined;
  }

  try {
    const parsed = JSON.parse(content) as Partial<ManagedInstallFailure>;
    if (isManagedInstallFailure(parsed)) {
      managedInstallFailure = parsed;
      return parsed;
    }
  } catch {
  }

  managedInstallFailure = undefined;
  return undefined;
}

export async function persistManagedInstallFailure(
  failure: ManagedInstallFailure,
  inputs: ManagedInstallFailurePersistenceInputs = {}
): Promise<void> {
  managedInstallFailure = failure;
  const failurePath = resolveManagedInstallFailurePath(inputs.storageRoot);
  if (!failurePath) {
    return;
  }

  await (inputs.ensureDir ?? defaultEnsureDir)(path.dirname(failurePath));
  await (inputs.writeFile ?? defaultWriteFile)(failurePath, `${JSON.stringify(failure, null, 2)}\n`);
}

export async function clearManagedInstallFailureRecord(
  inputs: ManagedInstallFailurePersistenceInputs = {}
): Promise<void> {
  managedInstallFailure = undefined;
  const failurePath = resolveManagedInstallFailurePath(inputs.storageRoot);
  if (!failurePath) {
    return;
  }

  await (inputs.removeFile ?? defaultRemoveFile)(failurePath);
}

export function detectManagedInstallTarget(
  platform: NodeJS.Platform = process.platform,
  arch: NodeJS.Architecture = process.arch
): ManagedInstallTarget | undefined {
  if (platform === "darwin" && arch === "arm64") {
    return {
      platform,
      arch,
      targetTriple: "aarch64-apple-darwin",
      archiveFormat: ".tar.xz"
    };
  }

  if (platform === "darwin" && arch === "x64") {
    return {
      platform,
      arch,
      targetTriple: "x86_64-apple-darwin",
      archiveFormat: ".tar.xz"
    };
  }

  if (platform === "linux" && arch === "arm64") {
    return {
      platform,
      arch,
      targetTriple: "aarch64-unknown-linux-gnu",
      archiveFormat: ".tar.xz"
    };
  }

  if (platform === "linux" && arch === "x64") {
    return {
      platform,
      arch,
      targetTriple: "x86_64-unknown-linux-gnu",
      archiveFormat: ".tar.xz"
    };
  }

  if (platform === "win32" && arch === "x64") {
    return {
      platform,
      arch,
      targetTriple: "x86_64-pc-windows-msvc",
      archiveFormat: ".zip"
    };
  }

  return undefined;
}

export function resolveManagedInstallPaths(
  installRoot: string,
  version: string,
  target: ManagedInstallTarget
): ManagedInstallPaths {
  const archiveFileName = `patchloom-${target.targetTriple}${target.archiveFormat}`;
  const checksumFileName = `${archiveFileName}.sha256`;
  const versionRoot = path.join(installRoot, version);
  return {
    installRoot,
    versionRoot,
    archiveFileName,
    archivePath: path.join(versionRoot, archiveFileName),
    checksumFileName,
    checksumPath: path.join(versionRoot, checksumFileName),
    binaryPath: path.join(versionRoot, PATCHLOOM_MANAGED_BINARY_DIR, managedBinaryName(target.platform))
  };
}

export function resolveManagedInstallTransactionPaths(
  installRoot: string,
  version: string,
  target: ManagedInstallTarget
): ManagedInstallTransactionPaths {
  const paths = resolveManagedInstallPaths(installRoot, version, target);
  const stagingRoot = path.join(paths.versionRoot, ".staging");
  return {
    ...paths,
    stagingRoot,
    stagedArchivePath: path.join(stagingRoot, paths.archiveFileName),
    stagedChecksumPath: path.join(stagingRoot, paths.checksumFileName),
    stagedBinaryPath: path.join(stagingRoot, PATCHLOOM_MANAGED_BINARY_DIR, managedBinaryName(target.platform)),
    backupBinaryPath: `${paths.binaryPath}.bak`
  };
}

export function buildManagedInstallReleaseAssets(
  version: string,
  target: ManagedInstallTarget,
  repo = PATCHLOOM_RELEASE_REPO
): ManagedInstallReleaseAssets {
  const normalizedVersion = normalizeReleaseVersion(version);
  const paths = resolveManagedInstallPaths(PATCHLOOM_MANAGED_INSTALL_DIR, normalizedVersion, target);
  return {
    tagName: `v${normalizedVersion}`,
    archiveFileName: paths.archiveFileName,
    checksumFileName: paths.checksumFileName,
    archiveDownloadUrl: `https://github.com/${repo}/releases/download/v${normalizedVersion}/${paths.archiveFileName}`,
    checksumDownloadUrl: `https://github.com/${repo}/releases/download/v${normalizedVersion}/${paths.checksumFileName}`
  };
}

export function parseManagedInstallChecksumFile(content: string): ManagedInstallChecksumEntry[] {
  const entries: ManagedInstallChecksumEntry[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const match = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (!match) {
      throw new ManagedInstallVerificationError(
        "invalid-checksum-format",
        `Invalid checksum line: ${rawLine}`
      );
    }

    entries.push({
      sha256: match[1].toLowerCase(),
      fileName: match[2].trim()
    });
  }

  return entries;
}

export function resolveManagedInstallChecksum(
  checksumFileContent: string,
  archiveFileName: string
): string {
  const entry = parseManagedInstallChecksumFile(checksumFileContent)
    .find((candidate) => candidate.fileName === archiveFileName);

  if (!entry) {
    throw new ManagedInstallVerificationError(
      "missing-checksum",
      `Missing checksum entry for ${archiveFileName}.`
    );
  }

  return entry.sha256;
}

export function calculateSha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function verifyManagedInstallArchiveChecksum(
  archiveContent: string | Uint8Array,
  checksumFileContent: string,
  archiveFileName: string
): string {
  const expectedSha256 = resolveManagedInstallChecksum(checksumFileContent, archiveFileName);
  const actualSha256 = calculateSha256Hex(archiveContent);

  if (expectedSha256 !== actualSha256) {
    throw new ManagedInstallVerificationError(
      "checksum-mismatch",
      `Checksum mismatch for ${archiveFileName}. Expected ${expectedSha256}, got ${actualSha256}.`
    );
  }

  return actualSha256;
}

export function isTrustedManagedInstallDownloadUrl(
  url: string,
  repo = PATCHLOOM_RELEASE_REPO
): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && parsed.hostname === "github.com"
      && parsed.pathname.startsWith(`/${repo}/releases/download/`);
  } catch {
    return false;
  }
}

export function assertTrustedManagedInstallDownloadUrl(
  url: string,
  repo = PATCHLOOM_RELEASE_REPO
): void {
  if (!isTrustedManagedInstallDownloadUrl(url, repo)) {
    throw new ManagedInstallVerificationError(
      "untrusted-download-url",
      `Managed install downloads must come from https://github.com/${repo}/releases/download/.`
    );
  }
}

export async function clearManagedInstallStaging(
  inputs: ManagedInstallStagingCleanupInputs
): Promise<void> {
  await (inputs.removeDir ?? defaultRemoveDir)(inputs.paths.stagingRoot);
}

export async function promoteManagedInstallBinary(inputs: ManagedInstallPromotionInputs): Promise<void> {
  const fileExists = inputs.fileExists ?? defaultFileExists;
  const ensureDir = inputs.ensureDir ?? defaultEnsureDir;
  const renameFile = inputs.renameFile ?? defaultRenameFile;
  const removeFile = inputs.removeFile ?? defaultRemoveFile;
  const { paths } = inputs;

  await ensureDir(path.dirname(paths.binaryPath));

  const hadExistingBinary = await fileExists(paths.binaryPath);
  if (hadExistingBinary) {
    await removeIfExists(paths.backupBinaryPath, fileExists, removeFile);
    await renameFile(paths.binaryPath, paths.backupBinaryPath);
  }

  try {
    await renameFile(paths.stagedBinaryPath, paths.binaryPath);
    await removeIfExists(paths.backupBinaryPath, fileExists, removeFile);
    await clearManagedInstallFailureRecord(inputs.failurePersistence);
  } catch (error) {
    if (hadExistingBinary && await fileExists(paths.backupBinaryPath)) {
      await removeIfExists(paths.binaryPath, fileExists, removeFile);
      await renameFile(paths.backupBinaryPath, paths.binaryPath);
    }

    const message = `Failed to replace managed Patchloom binary (${formatError(error)}).`;
    const failure = {
      stage: "replace",
      reason: "replace-failed",
      message
    } satisfies ManagedInstallFailure;
    await persistManagedInstallFailure(failure, inputs.failurePersistence);
    throw new Error(message);
  }
}

export async function inspectManagedInstallStatus(
  inputs: ManagedInstallStatusInputs
): Promise<ManagedInstallStatus | undefined> {
  const target = inputs.target ?? detectManagedInstallTarget();
  const version = inputs.version ? normalizeReleaseVersion(inputs.version) : undefined;
  if (!target || !version) {
    return undefined;
  }

  const paths = resolveManagedInstallPaths(inputs.installRoot, version, target);
  const exists = await (inputs.fileExists ?? defaultFileExists)(paths.binaryPath);
  await loadManagedInstallFailure(inputs.failurePersistence);
  return {
    exists,
    binaryPath: paths.binaryPath,
    version,
    target,
    ...(managedInstallFailure ? { failure: managedInstallFailure } : {})
  };
}

export function normalizeReleaseVersion(version: string): string {
  return version.replace(/^v/, "").trim();
}

function managedBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "patchloom.exe" : "patchloom";
}

function resolveManagedInstallFailurePath(storageRoot?: string): string | undefined {
  if (!storageRoot) {
    return undefined;
  }
  return path.join(storageRoot, PATCHLOOM_MANAGED_INSTALL_FAILURE_FILE);
}

function isManagedInstallFailure(value: Partial<ManagedInstallFailure> | undefined): value is ManagedInstallFailure {
  return typeof value?.stage === "string"
    && ["download", "verify", "extract", "replace"].includes(value.stage)
    && typeof value.reason === "string"
    && [
      "missing-checksum",
      "invalid-checksum-format",
      "checksum-mismatch",
      "untrusted-download-url",
      "download-failed",
      "extract-failed",
      "replace-failed"
    ].includes(value.reason)
    && typeof value.message === "string";
}

async function removeIfExists(
  filePath: string,
  fileExists: (filePath: string) => Promise<boolean>,
  removeFile: (filePath: string) => Promise<void>
): Promise<void> {
  if (await fileExists(filePath)) {
    await removeFile(filePath);
  }
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await (await import("node:fs/promises")).access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function defaultReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await (await import("node:fs/promises")).readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

async function defaultEnsureDir(dirPath: string): Promise<void> {
  await (await import("node:fs/promises")).mkdir(dirPath, { recursive: true });
}

async function defaultRenameFile(from: string, to: string): Promise<void> {
  await (await import("node:fs/promises")).rename(from, to);
}

async function defaultWriteFile(filePath: string, content: string): Promise<void> {
  await (await import("node:fs/promises")).writeFile(filePath, content, "utf8");
}

async function defaultRemoveFile(filePath: string): Promise<void> {
  await (await import("node:fs/promises")).rm(filePath, { force: true });
}

async function defaultRemoveDir(dirPath: string): Promise<void> {
  await (await import("node:fs/promises")).rm(dirPath, { recursive: true, force: true });
}
