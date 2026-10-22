import { spawn } from "node:child_process";
import { patchloomLaunch } from "../binary/launch.js";
import { ensurePatchloomReadyOrNotify } from "../binary/patchloom.js";
import { getPatchloomLog, getPatchloomRuntimeConfig, logCliCommand } from "../logging/outputChannel.js";
import { inspectMcpTargets, readMcpConfigText, readPatchloomMcpCommand } from "../mcp/config.js";
import { mergePatchloomEnv } from "../util.js";
import { activeWorkspaceFolder } from "../workspace/readiness.js";

export function selectVerifyMcpCommand(configuredCommand: string | undefined, fallbackBinary: string): string {
  const trimmed = configuredCommand?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : fallbackBinary;
}

const VERIFY_MCP_KIND_ORDER = ["portable-workspace", "cursor-workspace", "vscode-workspace"] as const;

/** Portable workspace wins over the older VS Code file when both name a command. */
export function preferredVerifyMcpCommand(
  entries: readonly { readonly kind: string; readonly command?: string }[]
): string | undefined {
  for (const kind of VERIFY_MCP_KIND_ORDER) {
    const command = entries.find((entry) => entry.kind === kind)?.command?.trim();
    if (command) {
      return command;
    }
  }
  return undefined;
}

export function verifyMcpWorkingDirectory(workspacePath: string | undefined): string | undefined {
  const trimmed = workspacePath?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface VerifyMcpInputs {
  readonly binaryPath: string;
  readonly configuredCommand?: string;
  readonly cwd?: string;
  readonly spawnProcess?: (command: string, cwd?: string) => Promise<VerifyMcpResult>;
}

export interface VerifyMcpResult {
  readonly ok: boolean;
  readonly serverName?: string;
  readonly serverVersion?: string;
  readonly message: string;
}

export async function verifyMcp(): Promise<void> {
  const vscode = await import("vscode");
  const binaryPath = await ensurePatchloomReadyOrNotify("Upgrade Patchloom before verifying the MCP server.");
  if (!binaryPath) {
    return;
  }

  const folderCount = vscode.workspace.workspaceFolders?.length ?? 0;
  const folder = await activeWorkspaceFolder({
    promptIfMany: true,
    placeHolder: "Select the workspace folder whose MCP server to verify"
  });
  if (!folder && folderCount > 1) {
    return;
  }
  const targets = await inspectMcpTargets({
    workspaceFolderPath: folder?.uri.fsPath,
    includeUserTarget: false
  });
  const entries = [];
  for (const target of targets) {
    entries.push({
      kind: target.kind,
      command: readPatchloomMcpCommand(target.kind, await readMcpConfigText(target.filePath))
    });
  }
  const configuredCommand = preferredVerifyMcpCommand(entries);

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Patchloom",
      cancellable: false
    },
    async (progress) => {
      progress.report({ message: "Verifying MCP server..." });
      return verifyMcpServer({
        binaryPath,
        configuredCommand,
        cwd: verifyMcpWorkingDirectory(folder?.uri.fsPath)
      });
    }
  );

  const log = getPatchloomLog();
  log?.log(`MCP verify: ${result.message}`);

  if (result.ok) {
    await vscode.window.showInformationMessage(result.message);
  } else {
    log?.show();
    await vscode.window.showErrorMessage(result.message);
  }
}

export async function verifyMcpServer(inputs: VerifyMcpInputs): Promise<VerifyMcpResult> {
  const spawnFn = inputs.spawnProcess ?? spawnMcpServer;
  const command = selectVerifyMcpCommand(inputs.configuredCommand, inputs.binaryPath);
  try {
    return await spawnFn(command, inputs.cwd);
  } catch (error) {
    return {
      ok: false,
      message: `MCP server failed to start: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function spawnMcpServer(binaryPath: string, cwd?: string): Promise<VerifyMcpResult> {
  const runtime = await getPatchloomRuntimeConfig();
  const env = mergePatchloomEnv(process.env, runtime.extraEnv);
  const launch = patchloomLaunch(binaryPath, ["mcp-server"]);
  logCliCommand(getPatchloomLog(), runtime.trace, launch.file, launch.args, cwd ?? process.cwd());

  return new Promise((resolve) => {
    const child = spawn(launch.file, launch.args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
      windowsHide: true,
      shell: launch.shell,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
      env
    });

    let stdout = "";
    let stderr = "";
    let resolved = false;

    const finish = (result: VerifyMcpResult): void => {
      if (resolved) {
        return;
      }
      resolved = true;
      child.kill();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        message: "MCP server did not respond within 10 seconds. Open Patchloom: Show Output, then run patchloom mcp-server --help in a terminal."
      });
    }, 10_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const result = parseInitializeResponse(stdout);
      if (result) {
        clearTimeout(timer);
        finish(result);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        message: `MCP server process error: ${error.message}`
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (!resolved) {
        finish({
          ok: false,
          message: `MCP server exited with code ${code ?? "unknown"}. ${stderr.trim()}`
        });
      }
    });

    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "patchloom-vscode-verify", version: "1.0.0" }
      }
    });
    child.stdin.write(request + "\n");
    child.stdin.end();
  });
}

export function parseInitializeResponse(data: string): VerifyMcpResult | undefined {
  for (const line of data.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      continue;
    }
    const response = parsed as Record<string, unknown>;
    if (response.jsonrpc !== "2.0") {
      continue;
    }

    if (response.error) {
      const error = response.error as Record<string, unknown>;
      return {
        ok: false,
        message: `MCP server returned error: ${error.message ?? JSON.stringify(error)}`
      };
    }

    if (response.result && typeof response.result === "object") {
      const result = response.result as Record<string, unknown>;
      const serverInfo = result.serverInfo as Record<string, unknown> | undefined;
      return {
        ok: true,
        serverName: serverInfo?.name as string | undefined,
        serverVersion: serverInfo?.version as string | undefined,
        message: serverInfo
          ? `MCP server verified: ${serverInfo.name} ${serverInfo.version ?? ""}`.trim()
          : "MCP server responded successfully."
      };
    }
  }
  return undefined;
}
