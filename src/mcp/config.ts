import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { configuredBinaryPathFromSetting } from "../binary/patchloom.js";
import { isRealPathInsideWorkspace } from "../workspace/pathContainment.js";

export type McpTargetKind =
  | "vscode-workspace"
  | "portable-workspace"
  | "cursor-workspace"
  | "windsurf-user";

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

/** A configure stop after zero or more targets were already written. */
export class McpConfigureError extends Error {
  readonly completed: readonly McpTargetResult[];

  constructor(message: string, completed: readonly McpTargetResult[]) {
    super(message);
    this.name = "McpConfigureError";
    this.completed = completed;
  }
}

/** Toast text when configure stops. Names targets that were already saved. */
export function formatMcpConfigureFailureMessage(error: unknown): string {
  const message = error instanceof Error && error.message.length > 0 ? error.message : String(error);
  const changed = error instanceof McpConfigureError
    ? error.completed.filter((result) => result.changed).length
    : 0;
  const saved = changed > 0 ? `Updated ${changed} MCP config target(s). ` : "";
  return `${saved}Failed to configure MCP: ${message}`;
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
   * `core` sets `PATCHLOOM_MCP_SURFACE=core` on the server entry (12 tools on CLI 0.37+; verified on 0.37.1).
   * Default `full` omits the env var so the CLI uses its full inventory.
   */
  readonly mcpSurface?: McpSurface;
}

export async function inspectMcpTargets(inputs: McpInspectionInputs): Promise<McpTargetStatus[]> {
  const readFile = inputs.readFile ?? defaultReadFile;
  const targets = resolveMcpTargets(inputs.workspaceFolderPath, inputs.homeDir, inputs.includeUserTarget);
  const results: McpTargetStatus[] = [];

  for (const target of targets) {
    if (!mcpConfigPathIsContained(target, inputs.workspaceFolderPath)) {
      results.push({
        ...target,
        exists: false,
        configured: false
      });
      continue;
    }
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
  const readFile = inputs.readFile ?? readMcpConfigText;
  const patchloomCommand = configuredBinaryPathFromSetting(inputs.patchloomPathSetting) ?? "patchloom";
  const includeKinds = inputs.includeKinds ? new Set(inputs.includeKinds) : undefined;
  const targets = resolveMcpTargets(inputs.workspaceFolderPath, inputs.homeDir, inputs.includeUserTarget)
    .filter((target) => !includeKinds || includeKinds.has(target.kind));
  const results: McpTargetResult[] = [];
  const mcpSurface = inputs.mcpSurface ?? "full";

  for (const target of targets) {
    try {
      assertMcpConfigWriteContained(target, inputs.workspaceFolderPath);
      const content = await readFile(target.filePath);
      const original = parseJsonObject(content, target.filePath);
      const entry = entryForKind(target.kind, patchloomCommand, mcpSurface);
      const key = usesMcpServersKey(target.kind) ? "mcpServers" : "servers";
      const existingRoot = original[key];
      const currentEntry = isPlainObject(existingRoot) ? existingRoot.patchloom : undefined;
      const hasText = typeof content === "string" && content.trim().length > 0;

      if (hasText && isPlainObject(existingRoot) && stableJson(currentEntry) === stableJson(entry)) {
        results.push({
          ...target,
          exists: true,
          configured: true,
          changed: false
        });
        continue;
      }

      if (hasText && existingRoot !== undefined && !isPlainObject(existingRoot)) {
        throw new Error(`Cannot update MCP config ${target.filePath}: "${key}" must be a JSON object`);
      }

      // JSON.stringify of the parse drops comments and trailing commas.
      const serialized = typeof content === "string" && content.trim().length > 0
        ? applyPatchloomEntry(content, key, entry)
        : `${JSON.stringify(withPatchloomEntry(target.kind, original, patchloomCommand, mcpSurface), null, 2)}\n`;
      await inputs.writeFile(target.filePath, serialized);

      results.push({
        ...target,
        exists: content !== undefined,
        configured: true,
        changed: true
      });
    } catch (error) {
      if (error instanceof McpConfigureError) {
        throw error;
      }
      const message = error instanceof Error && error.message.length > 0 ? error.message : String(error);
      throw new McpConfigureError(message, results);
    }
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
        kind: "portable-workspace",
        label: "Portable workspace",
        filePath: path.join(workspaceFolderPath, ".mcp.json")
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

function mcpConfigRoot(target: McpTarget, workspaceFolderPath?: string): string | undefined {
  if (target.kind === "windsurf-user") {
    return path.dirname(target.filePath);
  }
  return workspaceFolderPath;
}

function mcpConfigPathIsContained(target: McpTarget, workspaceFolderPath?: string): boolean {
  const root = mcpConfigRoot(target, workspaceFolderPath);
  if (!root) {
    return false;
  }
  // A user Windsurf directory that does not exist yet has nothing to follow.
  if (target.kind === "windsurf-user" && !existsSync(root)) {
    return true;
  }
  return isRealPathInsideWorkspace(root, target.filePath);
}

function assertMcpConfigWriteContained(target: McpTarget, workspaceFolderPath?: string): void {
  if (mcpConfigPathIsContained(target, workspaceFolderPath)) {
    return;
  }
  const root = mcpConfigRoot(target, workspaceFolderPath);
  throw new Error(
    root
      ? `Refusing to write MCP config ${target.filePath} because it resolves outside ${root}`
      : `Refusing to write MCP config ${target.filePath} because it resolves outside the workspace`
  );
}

function usesMcpServersKey(kind: McpTargetKind): boolean {
  return kind === "windsurf-user" || kind === "cursor-workspace" || kind === "portable-workspace";
}

function entryForKind(
  kind: McpTargetKind,
  commandPath: string,
  mcpSurface: McpSurface
): Record<string, unknown> {
  const entry = buildPatchloomMcpEntry(commandPath, mcpSurface);
  // Current VS Code marks `type` required on portable stdio servers.
  if (kind === "portable-workspace") {
    return { type: "stdio", ...entry };
  }
  return entry;
}

function withPatchloomEntry(
  kind: McpTargetKind,
  config: Record<string, unknown>,
  commandPath: string,
  mcpSurface: McpSurface = "full"
): Record<string, unknown> {
  const entry = entryForKind(kind, commandPath, mcpSurface);
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

function applyPatchloomEntry(content: string, key: string, entry: Record<string, unknown>): string {
  const edits = modify(content, [key, "patchloom"], entry, {
    formattingOptions: { insertSpaces: true, tabSize: 2 }
  });
  return applyEdits(content, edits);
}

function stableJson(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
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

function isEnoent(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

/**
 * Missing config is undefined. Any other read error throws so configure does
 * not replace an unreadable file with a patchloom-only object.
 */
export async function readMcpConfigText(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
}

async function defaultReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function defaultHomeDir(): string | undefined {
  return process.env.HOME ?? process.env.USERPROFILE;
}
