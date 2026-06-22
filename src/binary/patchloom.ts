import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  detectManagedInstallTarget,
  getManagedInstallRoot,
  inspectManagedInstallStatus,
  ManagedInstallStatus
} from "../install/managed.js";
import { formatError } from "../util.js";

const execFileAsync = promisify(execFile);

export const MINIMUM_SUPPORTED_PATCHLOOM_VERSION = "0.1.0";
export const PATCHLOOM_RELEASES_URL = "https://github.com/patchloom/patchloom/releases";
export const PATCHLOOM_DOCS_URL = "https://patchloom.github.io/patchloom/";

export type PatchloomSource = "setting" | "path" | "managed" | "missing";
export type PatchloomCompatibility = "supported" | "unsupported" | "unknown";

export interface PatchloomStatus {
  readonly ready: boolean;
  readonly source: PatchloomSource;
  readonly message: string;
  readonly binaryPath?: string;
  readonly version?: string;
  readonly detectedVersion?: string;
  readonly compatibility?: PatchloomCompatibility;
  readonly minimumSupportedVersion?: string;
  readonly compatibilityMessage?: string;
  readonly managedInstall?: ManagedInstallStatus;
  readonly diagnostics?: readonly string[];
}

export interface PatchloomCompatibilityAssessment {
  readonly compatibility: PatchloomCompatibility;
  readonly detectedVersion?: string;
  readonly minimumSupportedVersion: string;
  readonly message: string;
}

export interface PatchloomStatusInputs {
  readonly configuredPath?: string;
  readonly pathValue?: string;
  readonly platform?: NodeJS.Platform;
  readonly arch?: NodeJS.Architecture;
  readonly canExecute?: (binaryPath: string) => Promise<boolean>;
  readonly getVersion?: (binaryPath: string) => Promise<string | undefined>;
  readonly managedInstallRoot?: string;
  readonly managedFileExists?: (filePath: string) => Promise<boolean>;
  readonly isTrusted?: boolean;
}

export async function resolvePatchloomStatus(): Promise<PatchloomStatus> {
  const vscode = await import("vscode");
  const managedInstallRoot = getManagedInstallRoot();
  return resolvePatchloomStatusWithInputs({
    configuredPath: vscode.workspace.getConfiguration("patchloom").get<string>("path", ""),
    pathValue: process.env.PATH,
    platform: process.platform,
    arch: process.arch,
    managedInstallRoot,
    isTrusted: vscode.workspace.isTrusted
  });
}

export async function resolvePatchloomStatusWithInputs(inputs: PatchloomStatusInputs): Promise<PatchloomStatus> {
  const isTrusted = inputs.isTrusted ?? true;
  const configuredPath = isTrusted ? configuredBinaryPathFromSetting(inputs.configuredPath) : undefined;
  const canExecute = inputs.canExecute ?? isExecutable;
  const getVersion = inputs.getVersion ?? readVersion;
  const managedInstall = inputs.managedInstallRoot
    ? await inspectManagedInstallStatus({
      installRoot: inputs.managedInstallRoot,
      target: detectManagedInstallTarget(inputs.platform, inputs.arch),
      fileExists: inputs.managedFileExists,
      failurePersistence: {
        storageRoot: inputs.managedInstallRoot
      }
    })
    : undefined;
  const diagnostics = buildManagedInstallDiagnostics(managedInstall);

  if (configuredPath) {
    const status = await inspectCandidate(configuredPath, "setting", canExecute, getVersion);
    return withManagedInstallContext(status, managedInstall, diagnostics);
  }

  if (isTrusted) {
    const discoveredPath = await findOnPath(inputs.pathValue, inputs.platform, canExecute);
    if (discoveredPath) {
      const status = await inspectCandidate(discoveredPath, "path", canExecute, getVersion);
      return withManagedInstallContext(status, managedInstall, diagnostics);
    }
  }

  if (managedInstall?.exists) {
    const status = await inspectCandidate(managedInstall.binaryPath, "managed", canExecute, getVersion);
    return withManagedInstallContext(status, managedInstall, diagnostics);
  }

  const notFoundMessage = !isTrusted
    ? "Patchloom is restricted to the managed install in untrusted workspaces. Install via the managed installer or grant workspace trust."
    : managedInstall
      ? "Patchloom binary not found. Set patchloom.path, install patchloom on PATH, or install a managed Patchloom release."
      : "Patchloom binary not found. Set patchloom.path or install patchloom on PATH.";

  return {
    ready: false,
    source: "missing",
    message: notFoundMessage,
    compatibility: "unknown",
    minimumSupportedVersion: MINIMUM_SUPPORTED_PATCHLOOM_VERSION,
    managedInstall,
    diagnostics
  };
}

export function configuredBinaryPathFromSetting(configuredPath?: string): string | undefined {
  const configured = configuredPath?.trim();
  return configured ? configured : undefined;
}

export function describePatchloomSource(source: PatchloomSource): string {
  switch (source) {
    case "setting":
      return "patchloom.path";
    case "path":
      return "PATH";
    case "managed":
      return "managed install";
    case "missing":
      return "not found";
  }
}

export function describePatchloomCompatibility(compatibility?: PatchloomCompatibility): string {
  switch (compatibility) {
    case "supported":
      return "supported";
    case "unsupported":
      return "upgrade required";
    case "unknown":
      return "unable to verify";
    default:
      return "unknown";
  }
}

export function patchloomNeedsUpgrade(status: PatchloomStatus): boolean {
  return status.compatibility === "unsupported";
}

/**
 * Ensures Patchloom is ready (found + compatible). If not, shows a warning
 * and offers to open Settings or Releases. Returns the binaryPath if ready,
 * otherwise null (after showing UI).
 *
 * This removes duplicated ready-check + notify logic across commands.
 */
export async function ensurePatchloomReadyOrNotify(
  contextSuffix = "",
  testInputs?: PatchloomStatusInputs
): Promise<string | null> {
  const status = testInputs
    ? await resolvePatchloomStatusWithInputs(testInputs)
    : await resolvePatchloomStatus();

  if (!status.ready || !status.binaryPath) {
    const vscode = await import("vscode");
    const choice = await vscode.window.showWarningMessage(
      `${status.message}${contextSuffix ? `\n\n${contextSuffix}` : ""}`,
      "Open Settings"
    );
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand("patchloom.openPatchloomSettings");
    }
    return null;
  }

  if (patchloomNeedsUpgrade(status)) {
    const vscode = await import("vscode");
    const choice = await vscode.window.showWarningMessage(
      `${status.compatibilityMessage}${contextSuffix ? `\n\n${contextSuffix}` : ""}`,
      "Open Releases"
    );
    if (choice === "Open Releases") {
      await vscode.commands.executeCommand("patchloom.openPatchloomReleases");
    }
    return null;
  }

  return status.binaryPath;
}

export function parsePatchloomVersion(versionText?: string): string | undefined {
  if (!versionText) {
    return undefined;
  }

  const match = versionText.match(/\bv?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\b/);
  return match?.[0].replace(/^v/, "");
}

export function assessPatchloomCompatibility(
  versionText: string | undefined,
  minimumSupportedVersion = MINIMUM_SUPPORTED_PATCHLOOM_VERSION
): PatchloomCompatibilityAssessment {
  const detectedVersion = parsePatchloomVersion(versionText);
  if (!detectedVersion) {
    return {
      compatibility: "unknown",
      minimumSupportedVersion,
      message: `Patchloom CLI compatibility could not be verified. Expected ${minimumSupportedVersion} or newer.`
    };
  }

  if (comparePatchloomVersions(detectedVersion, minimumSupportedVersion) < 0) {
    return {
      compatibility: "unsupported",
      detectedVersion,
      minimumSupportedVersion,
      message: `Patchloom ${detectedVersion} is older than the minimum supported version ${minimumSupportedVersion}.`
    };
  }

  return {
    compatibility: "supported",
    detectedVersion,
    minimumSupportedVersion,
    message: `Patchloom ${detectedVersion} is supported.`
  };
}

export function comparePatchloomVersions(left: string, right: string): number {
  const leftVersion = parseSemanticVersion(left);
  const rightVersion = parseSemanticVersion(right);
  if (!leftVersion || !rightVersion) {
    return left.localeCompare(right);
  }

  for (let index = 0; index < 3; index += 1) {
    const diff = leftVersion.core[index] - rightVersion.core[index];
    if (diff !== 0) {
      return diff;
    }
  }

  if (!leftVersion.prerelease && !rightVersion.prerelease) {
    return 0;
  }
  if (!leftVersion.prerelease) {
    return 1;
  }
  if (!rightVersion.prerelease) {
    return -1;
  }

  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

async function inspectCandidate(
  binaryPath: string,
  source: Exclude<PatchloomSource, "missing">,
  canExecute: (binaryPath: string) => Promise<boolean>,
  getVersion: (binaryPath: string) => Promise<string | undefined>
): Promise<PatchloomStatus> {
  if (!(await canExecute(binaryPath))) {
    return {
      ready: false,
      source,
      binaryPath,
      message: `Patchloom binary is not executable: ${binaryPath}`,
      compatibility: "unknown",
      minimumSupportedVersion: MINIMUM_SUPPORTED_PATCHLOOM_VERSION
    };
  }

  try {
    const version = await getVersion(binaryPath);
    const compatibility = assessPatchloomCompatibility(version);
    return {
      ready: true,
      source,
      binaryPath,
      version,
      detectedVersion: compatibility.detectedVersion,
      compatibility: compatibility.compatibility,
      minimumSupportedVersion: compatibility.minimumSupportedVersion,
      compatibilityMessage: compatibility.message,
      message: `Using Patchloom from ${describePatchloomSource(source)}.`
    };
  } catch (error) {
    return {
      ready: false,
      source,
      binaryPath,
      message: `Found Patchloom at ${binaryPath}, but failed to run --version (${formatError(error)}).`,
      compatibility: "unknown",
      minimumSupportedVersion: MINIMUM_SUPPORTED_PATCHLOOM_VERSION
    };
  }
}

export async function findOnPath(
  pathValue = process.env.PATH,
  platform: NodeJS.Platform = process.platform,
  canExecute: (binaryPath: string) => Promise<boolean> = isExecutable
): Promise<string | undefined> {
  if (!pathValue) {
    return undefined;
  }

  const commands = platform === "win32"
    ? ["patchloom.exe", "patchloom.cmd", "patchloom.bat", "patchloom"]
    : ["patchloom"];
  const delimiter = platform === "win32" ? ";" : ":";
  const joinPath = platform === "win32" ? path.win32.join : path.posix.join;
  const seenDirs = new Set<string>();

  for (const rawDir of pathValue.split(delimiter)) {
    const dir = rawDir.trim();
    if (!dir || seenDirs.has(dir)) {
      continue;
    }
    seenDirs.add(dir);

    for (const command of commands) {
      const candidate = joinPath(dir, command);
      if (await canExecute(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

async function isExecutable(binaryPath: string): Promise<boolean> {
  try {
    await fs.access(binaryPath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readVersion(binaryPath: string): Promise<string | undefined> {
  const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], {
    timeout: 5_000,
    windowsHide: true
  });
  return `${stdout}${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

function withManagedInstallContext(
  status: PatchloomStatus,
  managedInstall: ManagedInstallStatus | undefined,
  diagnostics: readonly string[]
): PatchloomStatus {
  return {
    ...status,
    managedInstall,
    diagnostics
  };
}

function buildManagedInstallDiagnostics(managedInstall: ManagedInstallStatus | undefined): readonly string[] {
  if (!managedInstall?.failure) {
    return [];
  }

  return [
    `Managed install last failure stage: ${managedInstall.failure.stage}`,
    `Managed install last failure reason: ${managedInstall.failure.reason}`,
    `Managed install diagnostic: ${managedInstall.failure.message}`
  ];
}

interface ParsedSemanticVersion {
  readonly core: readonly [number, number, number];
  readonly prerelease?: readonly string[];
}

function parseSemanticVersion(version: string): ParsedSemanticVersion | undefined {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) {
    return undefined;
  }

  const prerelease = match[4]?.split(".").filter((segment) => segment.length > 0);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: prerelease && prerelease.length > 0 ? prerelease : undefined
  };
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftSegment = left[index];
    const rightSegment = right[index];
    if (leftSegment === undefined) {
      return -1;
    }
    if (rightSegment === undefined) {
      return 1;
    }
    if (leftSegment === rightSegment) {
      continue;
    }

    const leftNumber = /^[0-9]+$/.test(leftSegment) ? Number(leftSegment) : undefined;
    const rightNumber = /^[0-9]+$/.test(rightSegment) ? Number(rightSegment) : undefined;
    if (leftNumber !== undefined && rightNumber !== undefined) {
      return leftNumber - rightNumber;
    }
    if (leftNumber !== undefined) {
      return -1;
    }
    if (rightNumber !== undefined) {
      return 1;
    }
    return leftSegment.localeCompare(rightSegment);
  }

  return 0;
}
