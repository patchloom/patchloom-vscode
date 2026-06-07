import * as vscode from "vscode";
import { resolvePatchloomStatus } from "../binary/patchloom.js";
import { getPatchloomLog } from "../logging/outputChannel.js";

export function registerMcpServerProvider(context: vscode.ExtensionContext): void {
  // vscode.lm.registerMCPServerDefinitionProvider is available in VS Code 1.100+
  const lm = vscode.lm as typeof vscode.lm & {
    registerMCPServerDefinitionProvider?: (
      id: string,
      provider: { provideMCPServerDefinitions(): unknown[] }
    ) => vscode.Disposable;
  };
  if (typeof lm.registerMCPServerDefinitionProvider !== "function") {
    return;
  }

  const disposable = lm.registerMCPServerDefinitionProvider("patchloom", {
    provideMCPServerDefinitions() {
      return [buildMcpServerDefinition()];
    }
  });
  context.subscriptions.push(disposable);

  const log = getPatchloomLog();
  log?.log("Registered Patchloom MCP server via mcpServerDefinitionProviders API");
}

function buildMcpServerDefinition(): Record<string, unknown> {
  return {
    label: "Patchloom MCP",
    serverDefinition: {
      type: "stdio",
      command: "patchloom",
      args: ["mcp-server"]
    }
  };
}

export async function registerMcpServerProviderWithBinary(context: vscode.ExtensionContext): Promise<void> {
  const lm = vscode.lm as typeof vscode.lm & {
    registerMCPServerDefinitionProvider?: (
      id: string,
      provider: { provideMCPServerDefinitions(): unknown[] }
    ) => vscode.Disposable;
  };
  if (typeof lm.registerMCPServerDefinitionProvider !== "function") {
    return;
  }

  const status = await resolvePatchloomStatus();
  if (!status.ready || !status.binaryPath) {
    return;
  }

  const binaryPath = status.binaryPath;
  const disposable = lm.registerMCPServerDefinitionProvider("patchloom", {
    provideMCPServerDefinitions() {
      return [{
        label: "Patchloom MCP",
        serverDefinition: {
          type: "stdio",
          command: binaryPath,
          args: ["mcp-server"]
        }
      }];
    }
  });
  context.subscriptions.push(disposable);

  const log = getPatchloomLog();
  log?.log(`Registered Patchloom MCP server via native API (binary: ${binaryPath})`);
}
