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
