import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

export type PatchloomSource = "setting" | "path" | "missing";

export interface PatchloomStatus {
  readonly ready: boolean;
  readonly source: PatchloomSource;
  readonly message: string;
  readonly binaryPath?: string;
  readonly version?: string;
}

export async function resolvePatchloomStatus(): Promise<PatchloomStatus> {
  const configuredPath = configuredBinaryPath();
  if (configuredPath) {
    return inspectCandidate(configuredPath, "setting");
  }

  const discoveredPath = await findOnPath();
  if (discoveredPath) {
    return inspectCandidate(discoveredPath, "path");
  }

  return {
    ready: false,
    source: "missing",
    message: "Patchloom binary not found. Set patchloom.path or install patchloom on PATH."
  };
}

function configuredBinaryPath(): string | undefined {
  const configured = vscode.workspace.getConfiguration("patchloom").get<string>("path", "").trim();
  return configured.length > 0 ? configured : undefined;
}

async function inspectCandidate(binaryPath: string, source: Exclude<PatchloomSource, "missing">): Promise<PatchloomStatus> {
  try {
    await fs.access(binaryPath, fsConstants.X_OK);
  } catch {
    return {
      ready: false,
      source,
      binaryPath,
      message: `Patchloom binary is not executable: ${binaryPath}`
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], {
      timeout: 5_000,
      windowsHide: true
    });
    const version = `${stdout}${stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    return {
      ready: true,
      source,
      binaryPath,
      version,
      message: `Using Patchloom from ${source === "setting" ? "patchloom.path" : "PATH"}.`
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

async function findOnPath(): Promise<string | undefined> {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return undefined;
  }

  const candidates = process.platform === "win32"
    ? ["patchloom.exe", "patchloom.cmd", "patchloom.bat", "patchloom"]
    : ["patchloom"];

  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) {
      continue;
    }

    for (const command of candidates) {
      const candidate = path.join(dir, command);
      try {
        await fs.access(candidate, fsConstants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }

  return undefined;
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return String(error);
}
