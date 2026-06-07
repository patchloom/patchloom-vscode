import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import type { IncomingMessage, ClientRequest } from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { formatError } from "../util.js";

const execFileAsync = promisify(execFile);

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
    tagName: `patchloom-v${normalizedVersion}`,
    archiveFileName: paths.archiveFileName,
    checksumFileName: paths.checksumFileName,
    archiveDownloadUrl: `https://github.com/${repo}/releases/download/patchloom-v${normalizedVersion}/${paths.archiveFileName}`,
    checksumDownloadUrl: `https://github.com/${repo}/releases/download/patchloom-v${normalizedVersion}/${paths.checksumFileName}`
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

export interface FetchLatestReleaseInputs {
  readonly repo?: string;
  readonly fetchJson?: (url: string) => Promise<{ tag_name: string }>;
}

export interface DownloadToFileInputs {
  readonly url: string;
  readonly destPath: string;
  readonly ensureDir?: (dirPath: string) => Promise<void>;
  readonly download?: (url: string, destPath: string) => Promise<void>;
}

export interface ExtractArchiveInputs {
  readonly archivePath: string;
  readonly destDir: string;
  readonly format: PatchloomArchiveFormat;
  readonly ensureDir?: (dirPath: string) => Promise<void>;
  readonly execCommand?: (cmd: string, args: string[], cwd: string) => Promise<void>;
}

export interface PerformManagedInstallInputs {
  readonly installRoot: string;
  readonly version?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly repo?: string;
  readonly onProgress?: (stage: ManagedInstallStage) => void;
  readonly fetchLatestVersion?: (inputs?: FetchLatestReleaseInputs) => Promise<string>;
  readonly downloadFile?: (inputs: DownloadToFileInputs) => Promise<void>;
  readonly extractArchive?: (inputs: ExtractArchiveInputs) => Promise<void>;
  readonly readFileContent?: (filePath: string) => Promise<string>;
  readonly failurePersistence?: ManagedInstallFailurePersistenceInputs;
}

export interface ManagedInstallResult {
  readonly version: string;
  readonly binaryPath: string;
  readonly target: ManagedInstallTarget;
}

export type ManagedInstallStage =
  | "fetching-version"
  | "downloading-archive"
  | "downloading-checksum"
  | "verifying"
  | "extracting"
  | "installing";

export async function fetchLatestReleaseVersion(
  inputs: FetchLatestReleaseInputs = {}
): Promise<string> {
  const repo = inputs.repo ?? PATCHLOOM_RELEASE_REPO;
  const fetchJson = inputs.fetchJson ?? defaultFetchJson;
  const data = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
  const tag = data.tag_name;
  if (!tag) {
    throw new Error("GitHub API returned a release with no tag_name.");
  }
  return normalizeReleaseVersion(tag);
}

export async function downloadToFile(inputs: DownloadToFileInputs): Promise<void> {
  const ensureDir = inputs.ensureDir ?? defaultEnsureDir;
  const download = inputs.download ?? defaultDownloadToFile;
  await ensureDir(path.dirname(inputs.destPath));
  await download(inputs.url, inputs.destPath);
}

export async function extractManagedInstallArchive(inputs: ExtractArchiveInputs): Promise<void> {
  const ensureDir = inputs.ensureDir ?? defaultEnsureDir;
  const execCommand = inputs.execCommand ?? defaultExecCommand;
  await ensureDir(inputs.destDir);

  await execCommand("tar", ["xf", inputs.archivePath, "-C", inputs.destDir], inputs.destDir);
}

export async function performManagedInstall(inputs: PerformManagedInstallInputs): Promise<ManagedInstallResult> {
  const platform = inputs.platform ?? process.platform;
  const arch = inputs.arch ?? process.arch;
  const target = detectManagedInstallTarget(platform, arch);
  if (!target) {
    throw new Error(`Unsupported platform/architecture: ${platform}/${arch}`);
  }

  const report = inputs.onProgress ?? (() => {});
  const fetchVersion = inputs.fetchLatestVersion ?? fetchLatestReleaseVersion;
  const downloadFile = inputs.downloadFile ?? downloadToFile;
  const extractArchive = inputs.extractArchive ?? extractManagedInstallArchive;
  const readContent = inputs.readFileContent ?? defaultReadFileContent;

  let txPaths: ManagedInstallTransactionPaths | undefined;

  try {
    report("fetching-version");
    const version = inputs.version
      ? normalizeReleaseVersion(inputs.version)
      : await fetchVersion({ repo: inputs.repo });

    const assets = buildManagedInstallReleaseAssets(version, target, inputs.repo);
    txPaths = resolveManagedInstallTransactionPaths(inputs.installRoot, version, target);

    assertTrustedManagedInstallDownloadUrl(assets.archiveDownloadUrl, inputs.repo);
    assertTrustedManagedInstallDownloadUrl(assets.checksumDownloadUrl, inputs.repo);

    report("downloading-checksum");
    await downloadFile({
      url: assets.checksumDownloadUrl,
      destPath: txPaths.stagedChecksumPath
    });

    report("downloading-archive");
    await downloadFile({
      url: assets.archiveDownloadUrl,
      destPath: txPaths.stagedArchivePath
    });

    report("verifying");
    const checksumContent = await readContent(txPaths.stagedChecksumPath);
    const expectedSha256 = resolveManagedInstallChecksum(checksumContent, assets.archiveFileName);
    const actualSha256 = await streamingSha256(txPaths.stagedArchivePath);
    if (expectedSha256 !== actualSha256) {
      throw new ManagedInstallVerificationError(
        "checksum-mismatch",
        `Checksum mismatch for ${assets.archiveFileName}. Expected ${expectedSha256}, got ${actualSha256}.`
      );
    }

    report("extracting");
    await extractArchive({
      archivePath: txPaths.stagedArchivePath,
      destDir: txPaths.stagingRoot,
      format: target.archiveFormat
    });

    report("installing");
    await promoteManagedInstallBinary({
      paths: txPaths,
      failurePersistence: inputs.failurePersistence ?? { storageRoot: inputs.installRoot }
    });

    await clearManagedInstallStaging({ paths: txPaths });

    return { version, binaryPath: txPaths.binaryPath, target };
  } catch (error) {
    const stage = classifyInstallFailureStage(error);
    const failure: ManagedInstallFailure = {
      stage: stage.stage,
      reason: stage.reason,
      message: formatError(error)
    };
    await persistManagedInstallFailure(
      failure,
      inputs.failurePersistence ?? { storageRoot: inputs.installRoot }
    );
    if (txPaths) {
      try {
        await clearManagedInstallStaging({ paths: txPaths });
      } catch {
        // Best-effort cleanup; the failure is already persisted
      }
    }
    throw error;
  }
}

function classifyInstallFailureStage(error: unknown): { stage: ManagedInstallFailureStage; reason: ManagedInstallFailure["reason"] } {
  if (error instanceof ManagedInstallVerificationError) {
    return { stage: "verify", reason: error.reason };
  }
  const message = formatError(error).toLowerCase();
  if (message.includes("download") || message.includes("fetch") || message.includes("network")) {
    return { stage: "download", reason: "download-failed" };
  }
  if (message.includes("extract") || message.includes("tar") || message.includes("archive")) {
    return { stage: "extract", reason: "extract-failed" };
  }
  if (message.includes("replace") || message.includes("promote") || message.includes("rename")) {
    return { stage: "replace", reason: "replace-failed" };
  }
  return { stage: "download", reason: "download-failed" };
}

export function normalizeReleaseVersion(version: string): string {
  return version.replace(/^patchloom-v/, "").replace(/^v/, "").trim();
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

async function defaultFetchJson(url: string): Promise<{ tag_name: string }> {
  const response = await fetch(url, {
    headers: { "Accept": "application/vnd.github+json", "User-Agent": "patchloom-vscode" }
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<{ tag_name: string }>;
}

export type HttpGetFn = (
  url: string,
  options: object,
  callback: (response: IncomingMessage) => void
) => ClientRequest;

export function createDownloader(
  get: HttpGetFn
): (url: string, destPath: string, redirectsRemaining?: number) => Promise<void> {
  function download(url: string, destPath: string, redirectsRemaining = 5): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);
      const request = get(url, { headers: { "User-Agent": "patchloom-vscode" }, timeout: 30_000 }, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          if (redirectsRemaining <= 0) {
            reject(new Error(`Download failed: too many redirects for ${url}`));
            return;
          }
          download(response.headers.location, destPath, redirectsRemaining - 1).then(resolve, reject);
          return;
        }
        if (response.statusCode && response.statusCode >= 400) {
          file.close();
          reject(new Error(`Download failed: ${response.statusCode} ${response.statusMessage} for ${url}`));
          return;
        }
        response.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      });
      request.on("timeout", () => {
        request.destroy();
        file.close();
        reject(new Error(`Download timed out for ${url}`));
      });
      request.on("error", (error) => {
        file.close();
        reject(new Error(`Download failed for ${url}: ${formatError(error)}`));
      });
      file.on("error", (error) => {
        file.close();
        reject(new Error(`Failed to write download to ${destPath}: ${formatError(error)}`));
      });
    });
  }
  return download;
}

const defaultDownloadToFile = createDownloader(
  https.get.bind(https) as HttpGetFn
);

async function defaultExecCommand(cmd: string, args: string[], cwd: string): Promise<void> {
  await execFileAsync(cmd, args, { cwd, timeout: 60_000, windowsHide: true });
}

async function defaultReadFileContent(filePath: string): Promise<string> {
  return (await import("node:fs/promises")).readFile(filePath, "utf8");
}

export async function streamingSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}
