import * as path from "node:path";
import { configuredBinaryPathFromSetting } from "../binary/patchloom";

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

export interface McpApplyInputs extends McpInspectionInputs {
  readonly writeFile: (filePath: string, content: string) => Promise<void>;
  readonly patchloomPathSetting?: string;
  readonly includeKinds?: readonly McpTargetKind[];
}

export async function inspectMcpTargets(inputs: McpInspectionInputs): Promise<McpTargetStatus[]> {
  const readFile = inputs.readFile ?? defaultReadFile;
  const targets = resolveMcpTargets(inputs.workspaceFolderPath, inputs.homeDir, inputs.includeUserTarget);
  const results: McpTargetStatus[] = [];

  for (const target of targets) {
    const content = await readFile(target.filePath);
    const config = parseJsonObject(content);
    results.push({
      ...target,
      exists: content !== undefined,
      configured: hasPatchloomEntry(target.kind, config)
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

  for (const target of targets) {
    const content = await readFile(target.filePath);
    const original = parseJsonObject(content);
    const updated = withPatchloomEntry(target.kind, original, patchloomCommand);
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

export function buildPatchloomMcpEntry(commandPath: string): Record<string, unknown> {
  return {
    command: commandPath,
    args: ["mcp-server"]
  };
}

function withPatchloomEntry(kind: McpTargetKind, config: Record<string, unknown>, commandPath: string): Record<string, unknown> {
  const entry = buildPatchloomMcpEntry(commandPath);
  if (kind === "windsurf-user") {
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
  const key = kind === "windsurf-user" ? "mcpServers" : "servers";
  const root = objectValue(config[key]);
  return typeof root.patchloom === "object" && root.patchloom !== null;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function parseJsonObject(content: string | undefined): Record<string, unknown> {
  if (!content || !content.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
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
