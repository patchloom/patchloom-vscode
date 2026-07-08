import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type * as VSCode from "vscode";
import { ensurePatchloomReadyOrNotify } from "../binary/patchloom.js";
import { getPatchloomLog } from "../logging/outputChannel.js";
import { formatError } from "../util.js";
import { activeWorkspaceFolder } from "../workspace/readiness.js";

const execFileAsync = promisify(execFile);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type AgentsFileState = "missing" | "up_to_date" | "different";

export async function initializeProject(): Promise<void> {
  const vscode = await import("vscode");
  const { refreshStatusBar } = await import("../status/statusBar.js");
  const folder = await activeWorkspaceFolder({
    promptIfMany: true,
    placeHolder: "Select the workspace folder to initialize for Patchloom"
  });
  if (!folder) {
    await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom: Initialize Project.");
    return;
  }

  const binaryPath = await ensurePatchloomReadyOrNotify("Upgrade Patchloom before initializing this workspace.");
  if (!binaryPath) {
    return;
  }

  const modePick = await vscode.window.showQuickPick(
    [
      { label: "All (CLI + MCP)", description: "Default", mode: "all" as const },
      { label: "CLI only", description: "Omit MCP section", mode: "cli" as const },
      { label: "MCP only", description: "Lead with MCP tools", mode: "mcp" as const }
    ],
    { placeHolder: "Which agent-rules integration mode?" }
  );
  if (!modePick) {
    return;
  }

  const platformPick = await vscode.window.showQuickPick(
    [
      { label: "All platforms", description: "Default", platform: "all" as const },
      { label: "Linux / macOS", description: "POSIX shell examples", platform: "linux" as const },
      { label: "Windows", description: "Windows shell examples", platform: "windows" as const }
    ],
    { placeHolder: "Which platform for shell examples?" }
  );
  if (!platformPick) {
    return;
  }

  let rules: string;
  try {
    rules = await generateAgentRules(binaryPath, folder.uri.fsPath, {
      mode: modePick.mode,
      platform: platformPick.platform
    });
  } catch (error) {
    await vscode.window.showErrorMessage(`Failed to run patchloom agent-rules in ${folder.name}: ${formatError(error)}`);
    return;
  }

  if (!rules.trim()) {
    await vscode.window.showErrorMessage("patchloom agent-rules returned no output. Verify the CLI is working by running `patchloom agent-rules` in a terminal.");
    return;
  }

  const agentsUri = vscode.Uri.joinPath(folder.uri, "AGENTS.md");
  const existingContent = await readTextFileIfExists(agentsUri);
  const state = classifyAgentsFile(existingContent, rules);

  if (state === "missing") {
    await vscode.workspace.fs.writeFile(agentsUri, encoder.encode(rules));
    const doc = await vscode.workspace.openTextDocument(agentsUri);
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.window.showInformationMessage(`Created AGENTS.md in ${folder.name}.`);
    await refreshStatusBar();
    return;
  }

  if (state === "up_to_date") {
    const doc = await vscode.workspace.openTextDocument(agentsUri);
    await vscode.window.showTextDocument(doc, { preview: false });
    await vscode.window.showInformationMessage(`AGENTS.md in ${folder.name} is already up to date.`);
    await refreshStatusBar();
    return;
  }

  const generatedDoc = await vscode.workspace.openTextDocument({
    language: "markdown",
    content: rules
  });
  await vscode.commands.executeCommand(
    "vscode.diff",
    agentsUri,
    generatedDoc.uri,
    "AGENTS.md vs generated Patchloom rules"
  );
  await vscode.window.showWarningMessage("AGENTS.md already exists and differs. Opened a diff against newly generated rules.");
  await refreshStatusBar();
}

export function classifyAgentsFile(existingContent: string | undefined, generatedRules: string): AgentsFileState {
  if (existingContent === undefined) {
    return "missing";
  }

  return normalizeForComparison(existingContent) === normalizeForComparison(generatedRules)
    ? "up_to_date"
    : "different";
}

export type AgentRulesMode = "all" | "cli" | "mcp";
export type AgentRulesPlatform = "all" | "linux" | "windows";

export interface AgentRulesOptions {
  readonly mode?: AgentRulesMode;
  readonly platform?: AgentRulesPlatform;
}

/** Build `patchloom agent-rules` argv, omitting default `all` flags. */
export function buildAgentRulesArgs(options: AgentRulesOptions = {}): string[] {
  const args = ["agent-rules"];
  if (options.mode && options.mode !== "all") {
    args.push("--mode", options.mode);
  }
  if (options.platform && options.platform !== "all") {
    args.push("--platform", options.platform);
  }
  return args;
}

export async function generateAgentRules(
  binaryPath: string,
  cwd: string,
  options: AgentRulesOptions = {}
): Promise<string> {
  const log = getPatchloomLog();
  const args = buildAgentRulesArgs(options);
  log?.logCommand(binaryPath, args, cwd);
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, args, {
      cwd,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    log?.logResult(0, stdout, stderr);
    return stdout.endsWith("\n") ? stdout : `${stdout}\n`;
  } catch (error) {
    log?.logResult(1, "", formatError(error));
    throw error;
  }
}

async function readTextFileIfExists(uri: VSCode.Uri): Promise<string | undefined> {
  const vscode = await import("vscode");
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

function normalizeForComparison(value: string): string {
  return value.replace(/\r\n/g, "\n").trimEnd();
}
