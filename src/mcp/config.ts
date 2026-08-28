import * as path from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { configuredBinaryPathFromSetting } from "../binary/patchloom.js";

export type McpTargetKind = "vscode-workspace" | "cursor-workspace" | "windsurf-user";

export interface McpTarget {
  readonly kind: McpTargetKind;
  readonly label: string;
  readonly filePath: string;
}

export interface McpTargetStatus extends McpTarget {
  readonly exists: boolean;
  readonly configured: boolean;
}

export interface McpTargetResult extends McpTargetStatus {
  readonly changed: boolean;
}

export interface McpInspectionInputs {
  readonly workspaceFolderPath?: string;
  readonly homeDir?: string;
  readonly readFile?: (filePath: string) => Promise<string | undefined>;
  readonly includeUserTarget?: boolean;
}

export type McpSurface = "full" | "core";

export interface McpApplyInputs extends McpInspectionInputs {
  readonly writeFile: (filePath: string, content: string) => Promise<void>;
  readonly patchloomPathSetting?: string;
  readonly includeKinds?: readonly McpTargetKind[];
  /**
   * MCP tool inventory for coding agents (CLI 0.22+ / 0.24+).
   * `core` sets `PATCHLOOM_MCP_SURFACE=core` on the server entry (11 tools).
   * Default `full` omits the env var so the CLI uses its full inventory.
   */
  readonly mcpSurface?: McpSurface;
}

export async function inspectMcpTargets(inputs: McpInspectionInputs): Promise<McpTargetStatus[]> {
  const readFile = inputs.readFile ?? defaultReadFile;
  const targets = resolveMcpTargets(inputs.workspaceFolderPath, inputs.homeDir, inputs.includeUserTarget);
  const results: McpTargetStatus[] = [];

  for (const target of targets) {
    const content = await readFile(target.filePath);
    let configured = false;
    if (content !== undefined) {
      try {
        configured = hasPatchloomEntry(target.kind, parseJsonObject(content, target.filePath));
      } catch {
        configured = false;
      }
    }
    results.push({
      ...target,
      exists: content !== undefined,
      configured
    });
  }

  return results;
}

export async function configureMcpTargets(inputs: McpApplyInputs): Promise<McpTargetResult[]> {
  const readFile = inputs.readFile ?? defaultReadFile;
  const patchloomCommand = configuredBinaryPathFromSetting(inputs.patchloomPathSetting) ?? "patchloom";
  const includeKinds = inputs.includeKinds ? new Set(inputs.includeKinds) : undefined;
  const targets = resolveMcpTargets(inputs.workspaceFolderPath, inputs.homeDir, inputs.includeUserTarget)
    .filter((target) => !includeKinds || includeKinds.has(target.kind));
  const results: McpTargetResult[] = [];
  const mcpSurface = inputs.mcpSurface ?? "full";

  for (const target of targets) {
    const content = await readFile(target.filePath);
    const original = parseJsonObject(content, target.filePath);
    const updated = withPatchloomEntry(target.kind, original, patchloomCommand, mcpSurface);
    const serialized = `${JSON.stringify(updated, null, 2)}\n`;
    const previousSerialized = content === undefined ? undefined : `${JSON.stringify(original, null, 2)}\n`;
    const changed = previousSerialized !== serialized;

    if (changed) {
      await inputs.writeFile(target.filePath, serialized);
    }

    results.push({
      ...target,
      exists: content !== undefined,
      configured: true,
      changed
    });
  }

  return results;
}

export function resolveMcpTargets(
  workspaceFolderPath?: string,
  homeDir = defaultHomeDir(),
  includeUserTarget = true
): McpTarget[] {
  const targets: McpTarget[] = [];

  if (workspaceFolderPath) {
    targets.push(
      {
        kind: "vscode-workspace",
        label: "VS Code workspace",
        filePath: path.join(workspaceFolderPath, ".vscode", "mcp.json")
      },
      {
        kind: "cursor-workspace",
        label: "Cursor workspace",
        filePath: path.join(workspaceFolderPath, ".cursor", "mcp.json")
      }
    );
  }

  if (includeUserTarget && homeDir) {
    targets.push({
      kind: "windsurf-user",
      label: "Windsurf user",
      filePath: path.join(homeDir, ".codeium", "windsurf", "mcp_config.json")
    });
  }

  return targets;
}

export function buildPatchloomMcpEntry(
  commandPath: string,
  mcpSurface: McpSurface = "full"
): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    command: commandPath,
    args: ["mcp-server"]
  };
  if (mcpSurface === "core") {
    entry.env = { PATCHLOOM_MCP_SURFACE: "core" };
  }
  return entry;
}

function usesMcpServersKey(kind: McpTargetKind): boolean {
  return kind === "windsurf-user" || kind === "cursor-workspace";
}

function withPatchloomEntry(
  kind: McpTargetKind,
  config: Record<string, unknown>,
  commandPath: string,
  mcpSurface: McpSurface = "full"
): Record<string, unknown> {
  const entry = buildPatchloomMcpEntry(commandPath, mcpSurface);
  if (usesMcpServersKey(kind)) {
    const servers = objectValue(config.mcpServers);
    return {
      ...config,
      mcpServers: {
        ...servers,
        patchloom: entry
      }
    };
  }

  const servers = objectValue(config.servers);
  return {
    ...config,
    servers: {
      ...servers,
      patchloom: entry
    }
  };
}

function hasPatchloomEntry(kind: McpTargetKind, config: Record<string, unknown>): boolean {
  const key = usesMcpServersKey(kind) ? "mcpServers" : "servers";
  const root = objectValue(config[key]);
  return typeof root.patchloom === "object" && root.patchloom !== null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(content: string | undefined, filePath: string): Record<string, unknown> {
  if (!content || !content.trim()) {
    return {};
  }

  const errors: ParseError[] = [];
  const parsed: unknown = parse(content, errors, { allowTrailingComma: true });
  if (errors.length > 0 || !isPlainObject(parsed)) {
    throw new Error(`Cannot parse MCP config ${filePath}: invalid JSONC or not a JSON object`);
  }
  return { ...parsed };
}

async function defaultReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await (await import("node:fs/promises")).readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function defaultHomeDir(): string | undefined {
  return process.env.HOME ?? process.env.USERPROFILE;
}
