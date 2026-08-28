import type * as VSCode from "vscode";
import { resolvePatchloomStatus } from "../binary/patchloom.js";
import { getPatchloomLog } from "../logging/outputChannel.js";

/** Pure helper for native MCP definitions (no vscode). Empty when binary unknown. */
export function mcpServerDefinitionsForBinary(
  binaryPath: string | undefined
): readonly Record<string, unknown>[] {
  if (!binaryPath) {
    return [];
  }
  return [
    {
      label: "Patchloom MCP",
      serverDefinition: {
        type: "stdio",
        command: binaryPath,
        args: ["mcp-server"]
      }
    }
  ];
}

let resolvedBinaryPath: string | undefined;
let providerRegistered = false;

type LmWithMcpProvider = typeof VSCode.lm & {
  registerMCPServerDefinitionProvider?: (
    id: string,
    provider: { provideMCPServerDefinitions(): unknown[] }
  ) => VSCode.Disposable;
};

/** Resolve CLI binary and update the path used by the native MCP provider. */
export async function refreshMcpServerBinary(): Promise<void> {
  const status = await resolvePatchloomStatus();
  if (status.ready && status.binaryPath) {
    resolvedBinaryPath = status.binaryPath;
  } else {
    resolvedBinaryPath = undefined;
  }
}

/**
 * Always register the native MCP provider when the API exists.
 * Binary path is resolved at provide time and refreshed after managed install.
 */
export async function registerMcpServerProviderWithBinary(context: VSCode.ExtensionContext): Promise<void> {
  const vscode = await import("vscode");
  const lm = vscode.lm as LmWithMcpProvider;
  if (typeof lm.registerMCPServerDefinitionProvider !== "function") {
    return;
  }

  if (!providerRegistered) {
    const disposable = lm.registerMCPServerDefinitionProvider("patchloom", {
      provideMCPServerDefinitions() {
        return [...mcpServerDefinitionsForBinary(resolvedBinaryPath)];
      }
    });
    context.subscriptions.push(disposable);
    providerRegistered = true;

    const log = getPatchloomLog();
    log?.log("Registered Patchloom MCP server definition provider via native API");
  }

  await refreshMcpServerBinary();
  const log = getPatchloomLog();
  if (resolvedBinaryPath) {
    log?.log(`Patchloom MCP binary resolved: ${resolvedBinaryPath}`);
  } else {
    log?.log("Patchloom MCP binary not ready; provider will return empty until install/refresh");
  }
}
