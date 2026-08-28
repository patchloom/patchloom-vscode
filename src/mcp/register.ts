import type * as VSCode from "vscode";
import { resolvePatchloomStatus } from "../binary/patchloom.js";
import { getPatchloomLog, getPatchloomRuntimeConfig } from "../logging/outputChannel.js";
import { isAllowedPatchloomEnvKey } from "../util.js";

/** Plain descriptor used to construct vscode.McpStdioServerDefinition at register time. */
export interface McpServerBinaryDescriptor {
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
}

function patchloomOnlyEnv(extra: Record<string, string> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  if (extra === undefined) {
    return env;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (isAllowedPatchloomEnvKey(key)) {
      env[key] = value;
    }
  }
  return env;
}

/** Pure helper for native MCP definitions (no vscode). Empty when binary unknown. */
export function mcpServerDefinitionsForBinary(
  binaryPath: string | undefined,
  env?: Record<string, string>
): readonly McpServerBinaryDescriptor[] {
  if (!binaryPath) {
    return [];
  }
  return [
    {
      label: "Patchloom MCP",
      command: binaryPath,
      args: ["mcp-server"],
      env: patchloomOnlyEnv(env)
    }
  ];
}

type McpStdioServerDefinitionCtor = new (
  label: string,
  command: string,
  args: string[],
  env: Record<string, string>
) => unknown;

interface VsCodeLmWithMcp {
  registerMcpServerDefinitionProvider?(
    id: string,
    provider: {
      onDidChangeMcpServerDefinitions?: VSCode.Event<void>;
      provideMcpServerDefinitions(): unknown;
    }
  ): VSCode.Disposable;
}

interface VsCodeWithMcpApi {
  EventEmitter: typeof VSCode.EventEmitter;
  lm: VsCodeLmWithMcp;
  McpStdioServerDefinition?: McpStdioServerDefinitionCtor;
}

let resolvedBinaryPath: string | undefined;
let providerRegistered = false;
let didChangeEmitter: VSCode.EventEmitter<void> | undefined;

function mcpStdioCtor(vscode: VsCodeWithMcpApi): McpStdioServerDefinitionCtor | undefined {
  const ctor = vscode.McpStdioServerDefinition;
  return typeof ctor === "function" ? ctor : undefined;
}

export function createMcpStdioServerDefinition(
  Ctor: McpStdioServerDefinitionCtor,
  descriptor: McpServerBinaryDescriptor
): unknown | undefined {
  const args = [...descriptor.args];
  const env = descriptor.env ?? {};
  try {
    return new Ctor(descriptor.label, descriptor.command, args, env);
  } catch {
    return undefined;
  }
}

/** Resolve CLI binary and notify the native MCP provider so the editor list refreshes. */
export async function refreshMcpServerBinary(): Promise<void> {
  const status = await resolvePatchloomStatus();
  if (status.ready && status.binaryPath) {
    resolvedBinaryPath = status.binaryPath;
  } else {
    resolvedBinaryPath = undefined;
  }
  didChangeEmitter?.fire();
}

/**
 * Always register the native MCP provider when the VS Code 1.100+ API exists.
 * Binary path is resolved at provide time and refreshed after install/settings/trust.
 */
export async function registerMcpServerProviderWithBinary(context: VSCode.ExtensionContext): Promise<void> {
  const vscode = await import("vscode") as unknown as VsCodeWithMcpApi;
  const Ctor = mcpStdioCtor(vscode);
  if (typeof vscode.lm.registerMcpServerDefinitionProvider !== "function" || Ctor === undefined) {
    return;
  }

  if (!providerRegistered) {
    const emitter = new vscode.EventEmitter<void>();
    didChangeEmitter = emitter;
    context.subscriptions.push(emitter);

    const disposable = vscode.lm.registerMcpServerDefinitionProvider("patchloom", {
      onDidChangeMcpServerDefinitions: emitter.event,
      provideMcpServerDefinitions: async () => {
        const runtime = await getPatchloomRuntimeConfig();
        const definitions: unknown[] = [];
        for (const descriptor of mcpServerDefinitionsForBinary(resolvedBinaryPath, runtime.extraEnv)) {
          const definition = createMcpStdioServerDefinition(Ctor, descriptor);
          if (definition !== undefined) {
            definitions.push(definition);
          }
        }
        return definitions;
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
