import { resolvePatchloomEnvFromInspect, shouldLogCliCommands, shouldLogCliStreams } from "../util.js";

export interface PatchloomRuntimeConfig {
  readonly extraEnv: Record<string, string> | undefined;
  readonly trace: string;
}

export async function getPatchloomRuntimeConfig(): Promise<PatchloomRuntimeConfig> {
  const vscode = await import("vscode");
  const config = vscode.workspace.getConfiguration("patchloom");
  const envSource = resolvePatchloomEnvFromInspect(
    vscode.workspace.isTrusted,
    config.inspect("env"),
    config.get("env")
  );
  return {
    extraEnv: asStringEnv(envSource),
    trace: config.get<string>("trace.server", "off") ?? "off"
  };
}

function asStringEnv(value: unknown): Record<string, string> | undefined {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const extra: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") {
      extra[key] = raw;
    }
  }
  return extra;
}

export function logCliCommand(
  log: PatchloomLog | undefined,
  trace: string,
  binary: string,
  args: readonly string[],
  cwd: string
): void {
  if (shouldLogCliCommands(trace)) {
    log?.logCommand(binary, args, cwd);
  }
}

export function logCliResult(
  log: PatchloomLog | undefined,
  trace: string,
  exitCode: number,
  stdout: string,
  stderr: string
): void {
  if (!shouldLogCliCommands(trace)) {
    return;
  }
  if (shouldLogCliStreams(trace)) {
    log?.logResult(exitCode, stdout, stderr);
    return;
  }
  log?.logResult(exitCode, "", "");
}

export interface OutputChannelLike {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
  dispose(): void;
}

export interface PatchloomLog {
  log(message: string): void;
  logCommand(binary: string, args: readonly string[], cwd: string): void;
  logResult(exitCode: number, stdout: string, stderr: string): void;
  show(): void;
  dispose(): void;
}

let activeLog: PatchloomLog | undefined;

export function setPatchloomLog(log: PatchloomLog | undefined): void {
  activeLog = log;
}

export function getPatchloomLog(): PatchloomLog | undefined {
  return activeLog;
}

export function createPatchloomLog(
  createChannel: () => OutputChannelLike
): PatchloomLog {
  let channel: OutputChannelLike | undefined;

  function ensureChannel(): OutputChannelLike {
    if (!channel) {
      channel = createChannel();
    }
    return channel;
  }

  return {
    log(message: string): void {
      ensureChannel().appendLine(`[${new Date().toISOString()}] ${message}`);
    },
    logCommand(binary: string, args: readonly string[], cwd: string): void {
      const ch = ensureChannel();
      ch.appendLine(`[${new Date().toISOString()}] > ${binary} ${args.join(" ")}`);
      ch.appendLine(`  cwd: ${cwd}`);
    },
    logResult(exitCode: number, stdout: string, stderr: string): void {
      const ch = ensureChannel();
      if (stdout.trim()) {
        for (const line of stdout.trimEnd().split(/\r?\n/)) {
          ch.appendLine(line);
        }
      }
      if (stderr.trim()) {
        for (const line of stderr.trimEnd().split(/\r?\n/)) {
          ch.appendLine(`stderr: ${line}`);
        }
      }
      ch.appendLine(`[${new Date().toISOString()}] Exit code: ${exitCode}`);
    },
    show(): void {
      ensureChannel().show(true);
    },
    dispose(): void {
      channel?.dispose();
      channel = undefined;
    }
  };
}
