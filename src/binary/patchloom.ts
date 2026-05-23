import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PatchloomSource = "setting" | "path" | "missing";

export interface PatchloomStatus {
  readonly ready: boolean;
  readonly source: PatchloomSource;
  readonly message: string;
  readonly binaryPath?: string;
  readonly version?: string;
}

export interface PatchloomStatusInputs {
  readonly configuredPath?: string;
  readonly pathValue?: string;
  readonly platform?: NodeJS.Platform;
  readonly canExecute?: (binaryPath: string) => Promise<boolean>;
  readonly getVersion?: (binaryPath: string) => Promise<string | undefined>;
}

export async function resolvePatchloomStatus(): Promise<PatchloomStatus> {
  const vscode = await import("vscode");
  return resolvePatchloomStatusWithInputs({
    configuredPath: vscode.workspace.getConfiguration("patchloom").get<string>("path", ""),
    pathValue: process.env.PATH,
    platform: process.platform
  });
}

export async function resolvePatchloomStatusWithInputs(inputs: PatchloomStatusInputs): Promise<PatchloomStatus> {
  const configuredPath = configuredBinaryPathFromSetting(inputs.configuredPath);
  const canExecute = inputs.canExecute ?? isExecutable;
  const getVersion = inputs.getVersion ?? readVersion;

  if (configuredPath) {
    return inspectCandidate(configuredPath, "setting", canExecute, getVersion);
  }

  const discoveredPath = await findOnPath(inputs.pathValue, inputs.platform, canExecute);
  if (discoveredPath) {
    return inspectCandidate(discoveredPath, "path", canExecute, getVersion);
  }

  return {
    ready: false,
    source: "missing",
    message: "Patchloom binary not found. Set patchloom.path or install patchloom on PATH."
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
    case "missing":
      return "not found";
  }
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
      message: `Patchloom binary is not executable: ${binaryPath}`
    };
  }

  try {
    const version = await getVersion(binaryPath);
    return {
      ready: true,
      source,
      binaryPath,
      version,
      message: `Using Patchloom from ${describePatchloomSource(source)}.`
    };
  } catch (error) {
    return {
      ready: false,
      source,
      binaryPath,
      message: `Found Patchloom at ${binaryPath}, but failed to run --version (${formatError(error)}).`
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

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}
