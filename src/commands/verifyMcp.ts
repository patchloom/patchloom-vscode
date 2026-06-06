import { spawn } from "node:child_process";
import { patchloomNeedsUpgrade, resolvePatchloomStatus } from "../binary/patchloom.js";
import { getPatchloomLog } from "../logging/outputChannel.js";

export interface VerifyMcpInputs {
  readonly binaryPath: string;
  readonly spawnProcess?: typeof spawnMcpServer;
}

export interface VerifyMcpResult {
  readonly ok: boolean;
  readonly serverName?: string;
  readonly serverVersion?: string;
  readonly message: string;
}

export async function verifyMcp(): Promise<void> {
  const vscode = await import("vscode");
  const status = await resolvePatchloomStatus();
  if (!status.ready || !status.binaryPath) {
    await vscode.window.showWarningMessage(status.message);
    return;
  }

  if (patchloomNeedsUpgrade(status)) {
    await vscode.window.showWarningMessage(
      `${status.compatibilityMessage}\n\nUpgrade Patchloom before verifying the MCP server.`
    );
    return;
  }

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Patchloom",
      cancellable: false
    },
    async (progress) => {
      progress.report({ message: "Verifying MCP server..." });
      return verifyMcpServer({ binaryPath: status.binaryPath! });
    }
  );

  const log = getPatchloomLog();
  log?.log(`MCP verify: ${result.message}`);

  if (result.ok) {
    await vscode.window.showInformationMessage(result.message);
  } else {
    await vscode.window.showErrorMessage(result.message);
  }
}

export async function verifyMcpServer(inputs: VerifyMcpInputs): Promise<VerifyMcpResult> {
  const spawnFn = inputs.spawnProcess ?? spawnMcpServer;
  try {
    return await spawnFn(inputs.binaryPath);
  } catch (error) {
    return {
      ok: false,
      message: `MCP server failed to start: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function spawnMcpServer(binaryPath: string): Promise<VerifyMcpResult> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, ["mcp-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
      windowsHide: true
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
        message: "MCP server did not respond within 10 seconds."
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
