import { execFile, type ExecFileOptions } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PatchloomLaunchPlan {
  readonly file: string;
  readonly args: string[];
  /** Always false. `.cmd` shims go through `cmd.exe /d /s /c`, not `shell: true`. */
  readonly shell: false;
  readonly windowsVerbatimArguments: boolean;
}

/**
 * How to spawn a Patchloom binary.
 * Windows `npm install -g` exposes `patchloom.cmd`. Node `execFile` on that
 * shim fails with `spawn EINVAL` unless `cmd.exe` runs it.
 */
export function patchloomLaunch(
  binaryPath: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  comSpec?: string,
  verbatim = true
): PatchloomLaunchPlan {
  if (needsWindowsCommandProcessor(binaryPath, platform)) {
    const script = [binaryPath, ...args].map(quoteCmdArgument).join(" ");
    // `/s` strips one leading quote and the last quote. Callers that set
    // windowsVerbatimArguments must supply that pair. A host that quotes
    // argv itself (native MCP) must not get a second pair.
    const commandLine = verbatim ? `"${script}"` : script;
    return {
      file: resolveComSpec(platform, comSpec),
      args: ["/d", "/s", "/c", commandLine],
      shell: false,
      windowsVerbatimArguments: verbatim
    };
  }

  return {
    file: binaryPath,
    args: [...args],
    shell: false,
    windowsVerbatimArguments: false
  };
}

export async function execPatchloomFile(
  binaryPath: string,
  args: readonly string[],
  options: ExecFileOptions
): Promise<{ stdout: string; stderr: string }> {
  const launch = patchloomLaunch(binaryPath, args);
  const result = await execFileAsync(launch.file, launch.args, {
    ...options,
    encoding: "utf8",
    shell: launch.shell,
    windowsVerbatimArguments: launch.windowsVerbatimArguments
  });
  return {
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : ""
  };
}

function needsWindowsCommandProcessor(binaryPath: string, platform: NodeJS.Platform): boolean {
  if (platform !== "win32") {
    return false;
  }
  const extension = path.win32.extname(binaryPath).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    return true;
  }
  const bareName = !binaryPath.includes("\\")
    && !binaryPath.includes("/")
    && !path.win32.isAbsolute(binaryPath);
  return bareName && extension.length === 0;
}

function resolveComSpec(platform: NodeJS.Platform, comSpec?: string): string {
  if (comSpec && comSpec.trim().length > 0) {
    return comSpec;
  }
  if (platform === "win32") {
    const fromEnv = process.env.ComSpec;
    if (fromEnv && fromEnv.trim().length > 0) {
      return fromEnv;
    }
  }
  return "cmd.exe";
}

function quoteCmdArgument(value: string): string {
  if (/[\r\n]/.test(value)) {
    throw new Error(
      "Patchloom cannot pass a newline through the Windows npm shim (patchloom.cmd). Use the managed patchloom.exe, or keep this value on one line."
    );
  }
  const escaped = value.replaceAll("%", "%%");
  if (escaped.length === 0 || /[\s"&|<>^()]/.test(escaped)) {
    return `"${escaped.replaceAll("\"", "\"\"")}"`;
  }
  return escaped;
}
