import * as fs from "node:fs/promises";
import * as path from "node:path";
import type * as VSCode from "vscode";
import { execPatchloomFile } from "../binary/launch.js";
import { ensurePatchloomReadyOrNotify } from "../binary/patchloom.js";
import {
  getPatchloomLog,
  getPatchloomRuntimeConfig,
  logCliCommand,
  logCliResult,
  presentCliResultInOutput,
  type PatchloomLog
} from "../logging/outputChannel.js";
import { formatCliOutput, formatError, formatQuickActionCliOutput, mergePatchloomEnv, PATCHLOOM_CLI_TIMEOUT_MS } from "../util.js";
import { activeWorkspaceFolder, describeWorkspaceEnvironment } from "../workspace/readiness.js";
import {
  isRealPathInsideWorkspace,
  resolveWorkspaceRelativePath,
  sameRealFilePath
} from "../workspace/pathContainment.js";
import { dryRunFollowUp, previewSnapshotStillCurrent } from "./previewExit.js";

export {
  isPathInsideWorkspace,
  isRealPathInsideWorkspace,
  resolveWorkspaceRelativePath,
  sameRealFilePath
} from "../workspace/pathContainment.js";

const STRUCTURED_FILE_EXTENSIONS = new Set([
  ".json",
  ".jsonc",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".properties"
]);
const MARKDOWN_FILE_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);
/** Human label for picker copy. `.env` / `.env.*` are basename matches, not extensions. */
export const STRUCTURED_DOCUMENT_LABEL =
  "JSON, JSONC, YAML, TOML, .env, INI, or .properties";

/** `doc set` accepts a concrete path. A predicate is `doc update`. */
export const DOC_SET_SELECTOR_PROMPT =
  "Selector path. Use a concrete path such as scripts.test. A predicate such as servers[port>8000] goes to Update matching structured values.";
export const DOC_SET_SELECTOR_PLACEHOLDER = "scripts.test";

/** `doc update` is the multi-match write, including numeric compares. */
export const DOC_UPDATE_SELECTOR_PROMPT =
  "Selector path (wildcards, predicates, and numeric compares such as items[name=foo].v or servers[port>8000])";
export const DOC_UPDATE_SELECTOR_PLACEHOLDER = "items[*].enabled or servers[port>8000]";

export type TidyFix = "ensure-final-newline" | "trim-trailing-whitespace" | "normalize-eol-lf";

export interface PlannedQuickAction {
  readonly title: string;
  readonly targetPath: string;
  readonly targetArgIndices: readonly number[];
  /** Subcommand and operands. Do not put `--apply` or `--contain` here. */
  readonly args: readonly string[];
  /** When true, `serializePatchloomArgs` appends `--apply`. */
  readonly apply?: boolean;
}

export interface PatchloomInvocation {
  readonly args: readonly string[];
  readonly apply?: boolean;
  /** When true, prefix global `--contain`. `executePatchloom` defaults this to true. */
  readonly contain?: boolean;
}

/**
 * Build argv from flags plus operands. Never scans `args` for flag names.
 * `--apply` is inserted before `--` so clap still treats later tokens as operands.
 */
export function serializePatchloomArgs(invocation: PatchloomInvocation): string[] {
  const argv = [...invocation.args];
  if (invocation.apply) {
    const endOfOptions = argv.indexOf("--");
    if (endOfOptions === -1) {
      argv.push("--apply");
    } else {
      argv.splice(endOfOptions, 0, "--apply");
    }
  }
  if (invocation.contain) {
    argv.unshift("--contain");
  }
  return argv;
}

/** Options, then `--`, then positionals. Stops clap treating `--apply` as a flag. */
export function withEndOfOptions(head: readonly string[], operands: readonly string[]): string[] {
  return [...head, "--", ...operands];
}

/** `--flag=value` so clap does not treat `--` / `-n` as options. */
export function withOption(flag: string, value: string): string {
  return `${flag}=${value}`;
}

export const PATCHLOOM_PREVIEW_SCHEME = "patchloom-preview";

const previewBodies = new Map<string, string>();
let previewSequence = 0;

export function rememberPreviewBody(body: string): string {
  previewSequence += 1;
  const id = String(previewSequence);
  previewBodies.set(id, body);
  return id;
}

export function previewBodyForId(id: string): string {
  return previewBodies.get(id) ?? "";
}

export function createPreviewContentProvider(): VSCode.TextDocumentContentProvider {
  return {
    provideTextDocumentContent(uri: VSCode.Uri): string {
      return previewBodyForId(uri.path.replace(/^\//, ""));
    }
  };
}

/** First line of the editor selection, used to seed pattern and anchor fields. */
export function seedFromSelection(selection: string | undefined): string {
  if (!selection) {
    return "";
  }
  return selection.split(/\r?\n/, 1)[0] ?? "";
}

/** Scratch-file text. Real newlines stay newlines. */
export function contentFromScratch(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function previewWorkspaceFile(
  workspaceRoot: string,
  baseName: string,
  nonce: string
): { readonly directory: string; readonly filePath: string } {
  const directory = path.join(workspaceRoot, ".patchloom", `qa-preview-${nonce}`);
  return {
    directory,
    filePath: path.join(directory, path.basename(baseName))
  };
}

/** Preview runs with this cwd so workspace format config and EditorConfig apply. */
export function previewCwd(workspaceRoot: string): string {
  return workspaceRoot;
}

/** Backup directory names that appeared while a preview was running. */
export function newBackupSessionNames(before: readonly string[], after: readonly string[]): string[] {
  const known = new Set(before);
  return after.filter((name) => name.length > 0 && !known.has(name));
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

async function backupSessionNames(workspaceRoot: string): Promise<string[] | undefined> {
  try {
    return await fs.readdir(path.join(workspaceRoot, ".patchloom", "backups"));
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }
    return undefined;
  }
}

async function removePreviewBackupSessions(
  workspaceRoot: string,
  before: readonly string[] | undefined,
  nonce: string
): Promise<void> {
  if (!before) {
    return;
  }
  const after = await backupSessionNames(workspaceRoot);
  if (!after) {
    return;
  }
  for (const name of newBackupSessionNames(before, after)) {
    const sessionDir = path.join(workspaceRoot, ".patchloom", "backups", name);
    let manifest = "";
    try {
      manifest = await fs.readFile(path.join(sessionDir, "manifest.json"), "utf8");
    } catch (error) {
      if (!isEnoent(error)) {
        continue;
      }
    }
    if (!manifest.includes(`qa-preview-${nonce}`)) {
      continue;
    }
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch {
      // A locked session must not hide a preview that already succeeded.
    }
  }
}

export interface SearchHitLocation {
  readonly path: string;
  readonly line: number;
}

/** `path:line:` hits. A Windows drive letter is not treated as the line number. */
export function parseSearchHitLines(stdout: string): SearchHitLocation[] {
  const hits: SearchHitLocation[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    if (raw.trim().length === 0) {
      continue;
    }
    const match = /^(.*?):(\d+):/.exec(raw);
    if (!match || match[1].length === 0) {
      continue;
    }
    const line = Number(match[2]);
    if (!Number.isInteger(line) || line < 1) {
      continue;
    }
    hits.push({ path: match[1], line });
  }
  return hits;
}

/** One path per line. Opening a hit uses line 1. */
export function parseFilesWithoutMatchLines(stdout: string): SearchHitLocation[] {
  const hits: SearchHitLocation[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.startsWith("{")) {
      continue;
    }
    hits.push({ path: trimmed, line: 1 });
  }
  return hits;
}

export type UndoSelection =
  | { readonly kind: "latest" }
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "path"; readonly relativePath: string };

export function buildUndoArgs(selection: UndoSelection = { kind: "latest" }): string[] {
  if (selection.kind === "session") {
    return ["undo", "--session", selection.sessionId];
  }
  if (selection.kind === "path") {
    return ["undo", "--path", selection.relativePath];
  }
  return ["undo"];
}

export function emptyClipboardPatchMessage(text: string): string | undefined {
  if (text.trim().length === 0) {
    return "The clipboard has no patch text.";
  }
  return undefined;
}

export function presentSearchOutcome(
  log: PatchloomLog | undefined,
  result: { exitCode: number; stdout: string; stderr: string }
): "hits" | "none" | "error" {
  if (result.exitCode === 3) {
    return "none";
  }
  if (result.exitCode !== 0) {
    presentCliResultInOutput(log, result);
    return "error";
  }
  presentCliResultInOutput(log, result);
  return "hits";
}

/**
 * `--files-without-match` exits 3 when nothing is listed. An empty folder
 * and a glob that matches nothing use that same exit, so this must not
 * say every scanned file contains the pattern.
 */
export function filesWithoutMatchNoneMessage(pattern: string): string {
  return `No files without matches for "${pattern}".`;
}

/**
 * `patch apply` and `patch merge` exit 0 when a patch writes nothing
 * (`applied: false`). That is not a successful apply.
 */
export function patchCommandMadeNoChanges(stdout: string): boolean {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as { applied?: unknown };
    return parsed.applied === false;
  } catch {
    return false;
  }
}

export function presentPatchMergeOutcome(
  log: PatchloomLog | undefined,
  result: { exitCode: number; stdout: string; stderr: string }
): "ok" | "conflicts" | "error" {
  if (result.exitCode === 8) {
    presentCliResultInOutput(log, result);
    return "conflicts";
  }
  if (result.exitCode !== 0) {
    presentCliResultInOutput(log, result);
    return "error";
  }
  presentCliResultInOutput(log, result);
  return "ok";
}

export function presentUndoSuccess(
  log: PatchloomLog | undefined,
  result: { stdout: string; stderr: string }
): void {
  presentCliResultInOutput(log, result);
}

export function formatUndoFailureMessage(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): string {
  if (result.stderr.includes("no backup")) {
    return "No patchloom backup to undo.";
  }
  return `Patchloom undo failed: ${formatCliOutput(result)}`;
}

interface WorkspaceFileTarget {
  readonly workspaceFolder: VSCode.WorkspaceFolder;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly uri: VSCode.Uri;
}

interface PatchloomCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function activeSelectionSeed(vscode: typeof VSCode): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    return undefined;
  }
  const seed = seedFromSelection(editor.document.getText(editor.selection));
  return seed.length > 0 ? seed : undefined;
}

async function promptScratchText(
  vscode: typeof VSCode,
  workspaceRoot: string,
  prompt: string,
  required: boolean
): Promise<string | undefined> {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const directory = path.join(workspaceRoot, ".patchloom", `qa-input-${nonce}`);
  const filePath = path.join(directory, "content.txt");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(filePath, "", "utf8");
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(document, { preview: false });
    const choice = await vscode.window.showInformationMessage(
      `${prompt} Edit the scratch file (newlines are kept), then continue.`,
      "Use this text"
    );
    if (choice !== "Use this text") {
      return undefined;
    }
    if (document.isDirty && !(await document.save())) {
      return undefined;
    }
    const text = contentFromScratch(document.getText());
    if (required && text.length === 0) {
      await vscode.window.showWarningMessage("Content is required.");
      return undefined;
    }
    return text;
  } finally {
    try {
      await fs.rm(directory, { recursive: true, force: true });
    } catch {
      // The confirmed text is already captured. A locked scratch file must not drop it.
    }
  }
}

async function openSearchHit(
  vscode: typeof VSCode,
  workspaceRoot: string,
  hit: SearchHitLocation
): Promise<void> {
  const absolutePath = path.resolve(workspaceRoot, hit.path);
  if (!isRealPathInsideWorkspace(workspaceRoot, absolutePath)) {
    await vscode.window.showWarningMessage(`Refusing to open ${hit.path}: it is outside the workspace.`);
    return;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
  const line = Math.max(0, hit.line - 1);
  await vscode.window.showTextDocument(document, {
    preview: false,
    selection: new vscode.Range(line, 0, line, 0)
  });
}

async function pickSearchHit(
  vscode: typeof VSCode,
  workspaceRoot: string,
  hits: readonly SearchHitLocation[],
  placeHolder: string
): Promise<void> {
  if (hits.length === 0) {
    return;
  }
  const selection = await vscode.window.showQuickPick(
    hits.map((hit, index) => ({
      label: hit.path,
      description: `line ${hit.line}`,
      hit,
      index
    })),
    { placeHolder }
  );
  if (!selection) {
    return;
  }
  await openSearchHit(vscode, workspaceRoot, selection.hit);
}

async function stageClipboardPatch(workspaceRoot: string, text: string): Promise<StagedExternalPatch> {
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const directory = path.join(workspaceRoot, ".patchloom", `qa-patch-${nonce}`);
  await fs.mkdir(directory, { recursive: true });
  const patchPath = path.join(directory, "clipboard.patch");
  try {
    await fs.writeFile(patchPath, text, "utf8");
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    patchPath,
    cleanup: async () => {
      await fs.rm(directory, { recursive: true, force: true });
    }
  };
}

async function choosePatchSource(
  vscode: typeof VSCode,
  folder: VSCode.WorkspaceFolder
): Promise<StagedExternalPatch | undefined> {
  const source = await vscode.window.showQuickPick(
    [
      { label: "File", description: "Choose a patch file", source: "file" as const },
      { label: "Clipboard", description: "Use the patch text on the clipboard", source: "clipboard" as const }
    ],
    { placeHolder: "Where is the patch?" }
  );
  if (!source) {
    return undefined;
  }
  if (source.source === "clipboard") {
    const text = await vscode.env.clipboard.readText();
    const empty = emptyClipboardPatchMessage(text);
    if (empty) {
      await vscode.window.showErrorMessage(empty);
      return undefined;
    }
    return stageClipboardPatch(folder.uri.fsPath, text);
  }

  const patchUri = await vscode.window.showOpenDialog({
    canSelectMany: false,
    defaultUri: folder.uri,
    filters: { "Patch files": ["patch", "diff"], "All files": ["*"] },
    openLabel: "Select Patch"
  });
  if (!patchUri || patchUri.length === 0) {
    return undefined;
  }
  return stageExternalPatchInWorkspace(folder.uri.fsPath, patchUri[0].fsPath);
}

async function previewThenApplyPatch(
  vscode: typeof VSCode,
  binaryPath: string,
  workspaceRoot: string,
  action: PlannedQuickAction,
  noun: "apply" | "merge"
): Promise<void> {
  const dry = await executePatchloom(binaryPath, { ...action, apply: false }, workspaceRoot);
  const log = getPatchloomLog();
  const followUp = dryRunFollowUp(noun, dry);
  if (noun === "merge" && followUp !== "apply") {
    presentPatchMergeOutcome(log, dry);
  } else {
    presentCliResultInOutput(log, dry);
  }
  if (followUp === "conflicts") {
    await vscode.window.showWarningMessage(
      "Patch merge found unresolved conflicts. Nothing was written. Run Merge patch again and choose Allow conflict markers to write them."
    );
    return;
  }
  if (followUp === "stop") {
    const label = noun === "merge" ? "Patch merge preview failed" : "Patch apply preview failed";
    await vscode.window.showErrorMessage(`${label}: ${formatCliOutput(dry)}`);
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    "Patch preview finished. Nothing has been written. Apply it now?",
    "Apply"
  );
  if (choice !== "Apply") {
    return;
  }

  const result = await executePatchloom(binaryPath, { ...action, apply: true }, workspaceRoot);
  if (noun === "merge") {
    const outcome = presentPatchMergeOutcome(log, result);
    if (outcome === "conflicts") {
      const message = patchCommandMadeNoChanges(result.stdout)
        ? "Patch merge found unresolved conflicts. Nothing was written."
        : "Patch merge completed with unresolved conflicts. Check the output for details.";
      await vscode.window.showWarningMessage(message);
    } else if (outcome === "error") {
      await vscode.window.showErrorMessage(`Patch merge failed: ${formatCliOutput(result)}`);
    } else if (patchCommandMadeNoChanges(result.stdout)) {
      await vscode.window.showWarningMessage("Patch merge made no changes.");
    } else {
      await vscode.window.showInformationMessage("Patch merged successfully.");
    }
    return;
  }

  presentCliResultInOutput(log, result);
  if (result.exitCode !== 0) {
    await vscode.window.showErrorMessage(`Patch apply failed: ${formatCliOutput(result)}`);
  } else if (patchCommandMadeNoChanges(result.stdout)) {
    await vscode.window.showWarningMessage("Patch made no changes.");
  } else {
    await vscode.window.showInformationMessage("Patch applied successfully.");
  }
}

export async function runQuickAction(): Promise<void> {
  const vscode = await import("vscode");
  const binaryPath = await ensurePatchloomReadyOrNotify("Upgrade Patchloom before running quick actions.");
  if (!binaryPath) {
    return;
  }

  const actions: Array<VSCode.QuickPickItem & { run: () => Promise<void> }> = [
    {
      label: "Replace text in file",
      description: "Literal text replacement with diff preview",
      detail: "Builds `patchloom replace <old> --new <new> <file>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a file for Patchloom replace");
        if (!target) {
          return;
        }

        const from = await vscode.window.showInputBox({
          prompt: "Text to find",
          placeHolder: "old_name",
          value: activeSelectionSeed(vscode),
          validateInput: (value) => value.length > 0 ? undefined : "Search text is required."
        });
        if (from === undefined) {
          return;
        }

        const to = await promptScratchText(
          vscode,
          target.workspaceFolder.uri.fsPath,
          "Replacement text",
          false
        );
        if (to === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildReplaceQuickAction(target.absolutePath, from, to));
      }
    },
    {
      label: "Insert text after match",
      description: "Line-oriented insert after each match (CLI 0.16+)",
      detail: "Builds `patchloom replace <pattern> --insert-after <text> <file>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a file for Patchloom insert-after");
        if (!target) {
          return;
        }

        const pattern = await vscode.window.showInputBox({
          prompt: "Text to match (anchor for the insert)",
          placeHolder: "existing_line_or_token",
          value: activeSelectionSeed(vscode),
          validateInput: (value) => value.length > 0 ? undefined : "Match text is required."
        });
        if (pattern === undefined) {
          return;
        }

        const content = await promptScratchText(
          vscode,
          target.workspaceFolder.uri.fsPath,
          "Text to insert after each match",
          false
        );
        if (content === undefined) {
          return;
        }

        await previewAndMaybeApply(
          binaryPath,
          target,
          buildInsertAfterMatchQuickAction(target.absolutePath, pattern, content)
        );
      }
    },
    {
      label: "Insert text before match",
      description: "Line-oriented insert before each match (CLI 0.16+)",
      detail: "Builds `patchloom replace <pattern> --insert-before <text> <file>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a file for Patchloom insert-before");
        if (!target) {
          return;
        }

        const pattern = await vscode.window.showInputBox({
          prompt: "Text to match (anchor for the insert)",
          placeHolder: "existing_line_or_token",
          value: activeSelectionSeed(vscode),
          validateInput: (value) => value.length > 0 ? undefined : "Match text is required."
        });
        if (pattern === undefined) {
          return;
        }

        const content = await promptScratchText(
          vscode,
          target.workspaceFolder.uri.fsPath,
          "Text to insert before each match",
          false
        );
        if (content === undefined) {
          return;
        }

        await previewAndMaybeApply(
          binaryPath,
          target,
          buildInsertBeforeMatchQuickAction(target.absolutePath, pattern, content)
        );
      }
    },
    {
      label: "Apply fragment at anchor",
      description: "Morph-style fragment at a unique anchor (CLI 0.22+)",
      detail: "Builds `patchloom apply-fragment <file> --after|--before|--old <anchor> --fragment <text>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a file for Patchloom apply-fragment");
        if (!target) {
          return;
        }

        const placementPick = await vscode.window.showQuickPick(
          [
            {
              label: "Insert after anchor",
              description: "Default for Morph-style snippets",
              placement: "after" as const
            },
            {
              label: "Insert before anchor",
              placement: "before" as const
            },
            {
              label: "Replace anchor span",
              description: "Replace the unique matched span with the fragment",
              placement: "old" as const
            }
          ],
          { placeHolder: "How should the fragment be placed relative to the anchor?" }
        );
        if (!placementPick) {
          return;
        }

        const anchor = await vscode.window.showInputBox({
          prompt: "Unique anchor text (exactly one match required by default)",
          placeHolder: placementPick.placement === "old" ? "span to replace" : "fn foo() {",
          value: activeSelectionSeed(vscode),
          validateInput: (value) => value.length > 0 ? undefined : "Anchor text is required."
        });
        if (anchor === undefined) {
          return;
        }

        const fragment = await promptScratchText(
          vscode,
          target.workspaceFolder.uri.fsPath,
          "Fragment text (Morph-style // ... existing code ... markers are stripped)",
          false
        );
        if (fragment === undefined) {
          return;
        }

        await previewAndMaybeApply(
          binaryPath,
          target,
          buildApplyFragmentQuickAction(target.absolutePath, placementPick.placement, anchor, fragment)
        );
      }
    },
    {
      label: "Tidy file",
      description: "Whitespace and newline cleanup with diff preview",
      detail: "Builds `patchloom tidy fix <file> ...`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a file for Patchloom tidy");
        if (!target) {
          return;
        }

        const fixes = await vscode.window.showQuickPick<VSCode.QuickPickItem & { fix: TidyFix }>([
          {
            label: "Ensure final newline",
            description: "Recommended",
            picked: true,
            fix: "ensure-final-newline"
          },
          {
            label: "Trim trailing whitespace",
            description: "Recommended",
            picked: true,
            fix: "trim-trailing-whitespace"
          },
          {
            label: "Normalize line endings to LF",
            description: "Optional",
            fix: "normalize-eol-lf"
          }
        ], {
          canPickMany: true,
          placeHolder: "Select tidy fixes to preview"
        });
        if (!fixes || fixes.length === 0) {
          return;
        }

        await previewAndMaybeApply(
          binaryPath,
          target,
          buildTidyQuickAction(target.absolutePath, fixes.map((fix) => fix.fix))
        );
      }
    },
    {
      label: "Set structured value",
      description: `Update ${STRUCTURED_DOCUMENT_LABEL} with diff preview`,
      detail: "Builds `patchloom doc set <file> <selector> <value>`",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc set");
        if (!target) {
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: DOC_SET_SELECTOR_PROMPT,
          placeHolder: DOC_SET_SELECTOR_PLACEHOLDER,
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        const value = await promptScratchText(vscode, target.workspaceFolder.uri.fsPath, "Value", true);
        if (value === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildDocSetQuickAction(target.absolutePath, selector, value));
      }
    },
    {
      label: "Update matching structured values",
      description: `Update all ${STRUCTURED_DOCUMENT_LABEL} nodes matching a wildcard or predicate`,
      detail: "Builds `patchloom doc update <file> <selector> <value>`",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc update");
        if (!target) {
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: DOC_UPDATE_SELECTOR_PROMPT,
          placeHolder: DOC_UPDATE_SELECTOR_PLACEHOLDER,
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        const value = await promptScratchText(vscode, target.workspaceFolder.uri.fsPath, "Value", true);
        if (value === undefined) {
          return;
        }

        await previewAndMaybeApply(
          binaryPath,
          target,
          buildDocUpdateQuickAction(target.absolutePath, selector, value)
        );
      }
    },
    {
      label: "Search text across files",
      description: "Find pattern matches in workspace files",
      detail: "Builds `patchloom search <pattern> [--glob <glob>] <workspace>`",
      run: async () => {
        const folder = await activeWorkspaceFolder({
          promptIfMany: true,
          placeHolder: "Select workspace folder for Patchloom search"
        });
        if (!folder) {
          await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom search.");
          return;
        }

        const pattern = await vscode.window.showInputBox({
          prompt: "Search pattern",
          placeHolder: "TODO|FIXME",
          value: activeSelectionSeed(vscode),
          validateInput: (value) => value.length > 0 ? undefined : "Pattern is required."
        });
        if (pattern === undefined) {
          return;
        }

        const glob = await vscode.window.showInputBox({
          prompt: "File glob (optional, leave empty for all files)",
          placeHolder: "*.ts"
        });
        if (glob === undefined) {
          return;
        }

        const action = buildSearchQuickAction(folder.uri.fsPath, pattern, glob || undefined);
        const result = await executePatchloom(binaryPath, action, folder.uri.fsPath);
        const log = getPatchloomLog();
        const outcome = presentSearchOutcome(log, result);

        if (outcome === "none") {
          await vscode.window.showInformationMessage(`No matches found for "${pattern}".`);
        } else if (outcome === "error") {
          await vscode.window.showErrorMessage(`Patchloom search failed: ${formatCliOutput(result)}`);
        } else {
          await vscode.window.showInformationMessage("Search results displayed in the Patchloom output channel.");
          await pickSearchHit(
            vscode,
            folder.uri.fsPath,
            parseSearchHitLines(result.stdout),
            "Open a search hit"
          );
        }
      }
    },
    {
      label: "Search files without match",
      description: "List files that do not contain the pattern (CLI 0.29+ -L)",
      detail: "Builds `patchloom search <pattern> --files-without-match [--glob <glob>] <workspace>`",
      run: async () => {
        const folder = await activeWorkspaceFolder({
          promptIfMany: true,
          placeHolder: "Select workspace folder for Patchloom search -L"
        });
        if (!folder) {
          await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom search.");
          return;
        }

        const pattern = await vscode.window.showInputBox({
          prompt: "Pattern that listed files must not contain",
          placeHolder: "TODO|FIXME",
          value: activeSelectionSeed(vscode),
          validateInput: (value) => value.length > 0 ? undefined : "Pattern is required."
        });
        if (pattern === undefined) {
          return;
        }

        const glob = await vscode.window.showInputBox({
          prompt: "File glob (optional, leave empty for all files)",
          placeHolder: "*.ts"
        });
        if (glob === undefined) {
          return;
        }

        const action = buildSearchQuickAction(folder.uri.fsPath, pattern, glob || undefined, {
          filesWithoutMatch: true
        });
        const result = await executePatchloom(binaryPath, action, folder.uri.fsPath);
        const log = getPatchloomLog();
        const outcome = presentSearchOutcome(log, result);

        if (outcome === "none") {
          await vscode.window.showInformationMessage(filesWithoutMatchNoneMessage(pattern));
        } else if (outcome === "error") {
          await vscode.window.showErrorMessage(`Patchloom search failed: ${formatCliOutput(result)}`);
        } else {
          await vscode.window.showInformationMessage(
            "Files without matches are listed in the Patchloom output channel."
          );
          await pickSearchHit(
            vscode,
            folder.uri.fsPath,
            parseFilesWithoutMatchLines(result.stdout),
            "Open a file without a match"
          );
        }
      }
    },
    {
      label: "Create a new file",
      description: "Scaffold a new file in the workspace",
      detail: "Builds `patchloom create <path> --content <text> --apply`",
      run: async () => {
        const folder = await activeWorkspaceFolder({
          promptIfMany: true,
          placeHolder: "Select workspace folder for Patchloom create"
        });
        if (!folder) {
          await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom create.");
          return;
        }

        const relativePath = await vscode.window.showInputBox({
          prompt: "File path relative to workspace",
          placeHolder: "src/newfile.ts",
          validateInput: (value) => value.trim().length > 0 ? undefined : "Path is required."
        });
        if (relativePath === undefined) {
          return;
        }

        const absolutePath = path.resolve(folder.uri.fsPath, relativePath.trim());
        try {
          resolveWorkspaceRelativePath(folder.uri.fsPath, absolutePath);
        } catch (error) {
          await vscode.window.showWarningMessage(formatError(error));
          return;
        }

        // Empty content is allowed; CLI requires --content or --stdin and --apply to write.
        const content = await promptScratchText(
          vscode,
          folder.uri.fsPath,
          "Initial file content (leave empty for an empty file)",
          false
        );
        if (content === undefined) {
          return;
        }

        const action = buildCreateQuickAction(absolutePath, content);
        const result = await executePatchloom(binaryPath, action, folder.uri.fsPath);

        if (result.exitCode !== 0) {
          presentCliResultInOutput(getPatchloomLog(), result);
          await vscode.window.showErrorMessage(`Patchloom create failed: ${formatCliOutput(result)}`);
          return;
        }

        const uri = vscode.Uri.file(absolutePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
        await vscode.window.showInformationMessage(`Created ${relativePath.trim()}.`);
      }
    },
    {
      label: "Append to file",
      description: "Append content to an existing file",
      detail: "Builds `patchloom append <file> --content <text>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a file to append to with Patchloom");
        if (!target) {
          return;
        }

        const content = await promptScratchText(
          vscode,
          target.workspaceFolder.uri.fsPath,
          "Content to append",
          true
        );
        if (content === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildAppendQuickAction(target.absolutePath, content));
      }
    },
    {
      label: "Prepend to file",
      description: "Prepend content to the beginning of an existing file",
      detail: "Builds `patchloom prepend <file> --content <text>` (CLI 0.9+)",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a file to prepend to with Patchloom");
        if (!target) {
          return;
        }

        const content = await promptScratchText(
          vscode,
          target.workspaceFolder.uri.fsPath,
          "Content to prepend",
          true
        );
        if (content === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildPrependQuickAction(target.absolutePath, content));
      }
    },
    {
      label: "Read structured value",
      description: `Read a value from ${STRUCTURED_DOCUMENT_LABEL}`,
      detail: "Builds `patchloom doc get <file> <selector>`",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc get");
        if (!target) {
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Selector path (CLI 0.30+ accepts numeric compares such as servers[port>8000])",
          placeHolder: "scripts.test or servers[port>8000]",
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        const action = buildDocGetQuickAction(target.absolutePath, selector);
        const result = await executePatchloom(binaryPath, action, target.workspaceFolder.uri.fsPath);

        if (result.exitCode !== 0) {
          presentCliResultInOutput(getPatchloomLog(), result);
          await vscode.window.showErrorMessage(`Patchloom doc get failed: ${formatCliOutput(result)}`);
          return;
        }

        const value = result.stdout.trim();
        await vscode.env.clipboard.writeText(value);
        await vscode.window.showInformationMessage(`${selector} = ${value} (copied to clipboard)`);
      }
    },
    {
      label: "List structured keys",
      description: `List object keys at a ${STRUCTURED_DOCUMENT_LABEL} selector`,
      detail: "Builds `patchloom doc keys <file> <selector>` (CLI 0.32+). Use `.` for the document root.",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc keys");
        if (!target) {
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Selector path (use . for the document root)",
          placeHolder: ".",
          value: ".",
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        const action = buildDocKeysQuickAction(target.absolutePath, selector);
        const result = await executePatchloom(binaryPath, action, target.workspaceFolder.uri.fsPath);

        if (result.exitCode !== 0) {
          presentCliResultInOutput(getPatchloomLog(), result);
          await vscode.window.showErrorMessage(`Patchloom doc keys failed: ${formatCliOutput(result)}`);
          return;
        }

        presentCliResultInOutput(getPatchloomLog(), result);
        const value = result.stdout.trim();
        await vscode.env.clipboard.writeText(value);
        await vscode.window.showInformationMessage(`Keys at ${selector} copied to clipboard`);
      }
    },
    {
      label: "Count structured length",
      description: "Count array items or object keys at a selector",
      detail: "Builds `patchloom doc len <file> <selector>` (CLI 0.32+). Use `.` for the document root.",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc len");
        if (!target) {
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Selector path (use . for the document root)",
          placeHolder: "items",
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        const action = buildDocLenQuickAction(target.absolutePath, selector);
        const result = await executePatchloom(binaryPath, action, target.workspaceFolder.uri.fsPath);

        if (result.exitCode !== 0) {
          presentCliResultInOutput(getPatchloomLog(), result);
          await vscode.window.showErrorMessage(`Patchloom doc len failed: ${formatCliOutput(result)}`);
          return;
        }

        presentCliResultInOutput(getPatchloomLog(), result);
        const value = result.stdout.trim();
        await vscode.env.clipboard.writeText(value);
        await vscode.window.showInformationMessage(`${selector} length = ${value} (copied to clipboard)`);
      }
    },
    {
      label: "Delete structured value",
      description: `Remove a key from ${STRUCTURED_DOCUMENT_LABEL} with diff preview`,
      detail: "Builds `patchloom doc delete <file> <selector>`",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc delete");
        if (!target) {
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Selector path to delete",
          placeHolder: "scripts.deprecated",
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildDocDeleteQuickAction(target.absolutePath, selector));
      }
    },
    {
      label: "Delete matching array items",
      description: "Remove array items matching a predicate with diff preview",
      detail: "Builds `patchloom doc delete-where --predicate <predicate> <file> <selector>`",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc delete-where");
        if (!target) {
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Array path only (for example items). Do not use items[name=stale]; put the match in the predicate.",
          placeHolder: "items",
          validateInput: (value) => value.length > 0 ? undefined : "Array path is required."
        });
        if (selector === undefined) {
          return;
        }

        const predicate = await vscode.window.showInputBox({
          prompt: "Per-item predicate as key=value (for example name=stale)",
          placeHolder: "name=stale",
          validateInput: (value) => value.length > 0 ? undefined : "Predicate is required."
        });
        if (predicate === undefined) {
          return;
        }

        await previewAndMaybeApply(
          binaryPath,
          target,
          buildDocDeleteWhereQuickAction(target.absolutePath, selector, predicate)
        );
      }
    },
    {
      label: "Merge into structured file",
      description: "Merge a partial JSON object into a config file",
      detail: "Builds `patchloom doc merge <file> [--selector <path>] --value <json>` (selector for multi-doc YAML, CLI 0.16+)",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc merge");
        if (!target) {
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Merge selector (optional). Multi-document YAML needs a document index (CLI 0.16+)",
          placeHolder: "leave empty for root, or 0 / [0] for the first multi-doc document"
        });
        if (selector === undefined) {
          return;
        }

        const value = await promptScratchText(
          vscode,
          target.workspaceFolder.uri.fsPath,
          "Partial JSON object to merge",
          true
        );
        if (value === undefined) {
          return;
        }

        await previewAndMaybeApply(
          binaryPath,
          target,
          buildDocMergeQuickAction(target.absolutePath, value, selector)
        );
      }
    },
    {
      label: "Append to array",
      description: `Append a value to a ${STRUCTURED_DOCUMENT_LABEL} array`,
      detail: "Builds `patchloom doc append <file> <selector> <value>`",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc append");
        if (!target) {
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Selector path to the array",
          placeHolder: "dependencies",
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        const value = await promptScratchText(vscode, target.workspaceFolder.uri.fsPath, "Value to append", true);
        if (value === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildDocAppendQuickAction(target.absolutePath, selector, value));
      }
    },
    {
      label: "Prepend to array",
      description: `Prepend a value to a ${STRUCTURED_DOCUMENT_LABEL} array`,
      detail: "Builds `patchloom doc prepend <file> <selector> <value>`",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc prepend");
        if (!target) {
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Selector path to the array",
          placeHolder: "dependencies",
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        const value = await promptScratchText(vscode, target.workspaceFolder.uri.fsPath, "Value to prepend", true);
        if (value === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildDocPrependQuickAction(target.absolutePath, selector, value));
      }
    },
    {
      label: "Ensure structured value",
      description: "Idempotent set: only write if the key is missing",
      detail: "Builds `patchloom doc ensure <file> <selector> <value>`",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc ensure");
        if (!target) {
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Selector path",
          placeHolder: "server.port",
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        const value = await promptScratchText(
          vscode,
          target.workspaceFolder.uri.fsPath,
          "Default value (set only if missing)",
          true
        );
        if (value === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildDocEnsureQuickAction(target.absolutePath, selector, value));
      }
    },
    {
      label: "Move/rename key",
      description: `Move or rename a selector path in ${STRUCTURED_DOCUMENT_LABEL}`,
      detail: "Builds `patchloom doc move <file> <from> <to>`",
      run: async () => {
        const target = await pickStructuredDocumentTarget("doc move");
        if (!target) {
          return;
        }

        const from = await vscode.window.showInputBox({
          prompt: "Source selector path",
          placeHolder: "old.key",
          validateInput: (value) => value.length > 0 ? undefined : "Source selector is required."
        });
        if (from === undefined) {
          return;
        }

        const to = await vscode.window.showInputBox({
          prompt: "Destination selector path",
          placeHolder: "new.key",
          validateInput: (value) => value.length > 0 ? undefined : "Destination selector is required."
        });
        if (to === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildDocMoveQuickAction(target.absolutePath, from, to));
      }
    },
    {
      label: "Insert after heading",
      description: "Insert content after a markdown heading",
      detail: "Builds `patchloom md insert-after-heading <file> --heading <h> --content <text>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a markdown file for Patchloom insert-after-heading");
        if (!target) {
          return;
        }

        if (!isMarkdownPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a markdown file. Pick a .md, .markdown, or .mdx file.`
          );
          return;
        }

        const heading = await vscode.window.showInputBox({
          prompt: "Heading to insert content after",
          placeHolder: "## Installation",
          validateInput: (value) => value.length > 0 ? undefined : "Heading is required."
        });
        if (heading === undefined) {
          return;
        }

        const content = await promptScratchText(vscode, target.workspaceFolder.uri.fsPath, "Content to insert", true);
        if (content === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildMdInsertAfterHeadingQuickAction(target.absolutePath, heading, content));
      }
    },
    {
      label: "Insert after section",
      description: "Insert a sibling section after a full markdown section body (CLI 0.14+)",
      detail: "Builds `patchloom md insert-after-section <file> --heading <h> --content <text>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a markdown file for Patchloom insert-after-section");
        if (!target) {
          return;
        }

        if (!isMarkdownPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a markdown file. Pick a .md, .markdown, or .mdx file.`
          );
          return;
        }

        const heading = await vscode.window.showInputBox({
          prompt: "Heading whose full section ends before the insertion",
          placeHolder: "## Config",
          validateInput: (value) => value.length > 0 ? undefined : "Heading is required."
        });
        if (heading === undefined) {
          return;
        }

        const content = await promptScratchText(
          vscode,
          target.workspaceFolder.uri.fsPath,
          "Sibling content to insert after the section body",
          true
        );
        if (content === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildMdInsertAfterSectionQuickAction(target.absolutePath, heading, content));
      }
    },
    {
      label: "Insert before heading",
      description: "Insert content before a markdown heading",
      detail: "Builds `patchloom md insert-before-heading <file> --heading <h> --content <text>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a markdown file for Patchloom insert-before-heading");
        if (!target) {
          return;
        }

        if (!isMarkdownPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a markdown file. Pick a .md, .markdown, or .mdx file.`
          );
          return;
        }

        const heading = await vscode.window.showInputBox({
          prompt: "Heading to insert content before",
          placeHolder: "## Changelog",
          validateInput: (value) => value.length > 0 ? undefined : "Heading is required."
        });
        if (heading === undefined) {
          return;
        }

        const content = await promptScratchText(vscode, target.workspaceFolder.uri.fsPath, "Content to insert", true);
        if (content === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildMdInsertBeforeHeadingQuickAction(target.absolutePath, heading, content));
      }
    },
    {
      label: "Append table row",
      description: "Append a row to a markdown table under a heading",
      detail: "Builds `patchloom md table-append <file> --heading <h> --row <row>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a markdown file for Patchloom table-append");
        if (!target) {
          return;
        }

        if (!isMarkdownPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a markdown file. Pick a .md, .markdown, or .mdx file.`
          );
          return;
        }

        const heading = await vscode.window.showInputBox({
          prompt: "Heading containing the table",
          placeHolder: "## API",
          validateInput: (value) => value.length > 0 ? undefined : "Heading is required."
        });
        if (heading === undefined) {
          return;
        }

        const row = await promptScratchText(
          vscode,
          target.workspaceFolder.uri.fsPath,
          "Table row to append (pipe-delimited)",
          true
        );
        if (row === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildMdTableAppendQuickAction(target.absolutePath, heading, row));
      }
    },
    {
      label: "Upsert bullet",
      description: "Add a bullet under a markdown heading (idempotent)",
      detail: "Builds `patchloom md upsert-bullet <file> --heading <h> --bullet <text>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a markdown file for Patchloom upsert-bullet");
        if (!target) {
          return;
        }

        if (!isMarkdownPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a markdown file. Pick a .md, .markdown, or .mdx file.`
          );
          return;
        }

        const heading = await vscode.window.showInputBox({
          prompt: "Heading to add the bullet under",
          placeHolder: "## Rules",
          validateInput: (value) => value.length > 0 ? undefined : "Heading is required."
        });
        if (heading === undefined) {
          return;
        }

        const bullet = await promptScratchText(
          vscode,
          target.workspaceFolder.uri.fsPath,
          "Bullet text (without leading dash)",
          true
        );
        if (bullet === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildMdUpsertBulletQuickAction(target.absolutePath, heading, bullet));
      }
    },
    {
      label: "Replace markdown section",
      description: "Replace content under a markdown heading",
      detail: "Builds `patchloom md replace-section <file> --heading <h> --content <text>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a markdown file for Patchloom replace-section");
        if (!target) {
          return;
        }

        if (!isMarkdownPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a markdown file. Pick a .md, .markdown, or .mdx file.`
          );
          return;
        }

        const heading = await vscode.window.showInputBox({
          prompt: "Heading of the section to replace",
          placeHolder: "## Unreleased",
          validateInput: (value) => value.length > 0 ? undefined : "Heading is required."
        });
        if (heading === undefined) {
          return;
        }

        const content = await promptScratchText(vscode, target.workspaceFolder.uri.fsPath, "New section content", true);
        if (content === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildMdReplaceSectionQuickAction(target.absolutePath, heading, content));
      }
    },
    {
      label: "Apply patch (unified / Begin Patch / SEARCH-REPLACE)",
      description: "Apply a unified diff, Codex Begin Patch, or Aider SEARCH/REPLACE",
      detail: "Builds `patchloom patch apply <file> --apply`",
      run: async () => {
        const folder = await activeWorkspaceFolder({
          promptIfMany: true,
          placeHolder: "Select workspace folder for Patchloom patch apply"
        });
        if (!folder) {
          await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom patch apply.");
          return;
        }

        const staged = await choosePatchSource(vscode, folder);
        if (!staged) {
          return;
        }
        try {
          const action = buildPatchApplyQuickAction(staged.patchPath);
          await previewThenApplyPatch(vscode, binaryPath, folder.uri.fsPath, action, "apply");
        } finally {
          await staged.cleanup();
        }
      }
    },
    {
      label: "Merge patch (three-way)",
      description: "Apply a stale patch using three-way merge",
      detail: "Builds `patchloom patch merge <file> --apply [--allow-conflicts]`",
      run: async () => {
        const folder = await activeWorkspaceFolder({
          promptIfMany: true,
          placeHolder: "Select workspace folder for Patchloom patch merge"
        });
        if (!folder) {
          await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom patch merge.");
          return;
        }

        const staged = await choosePatchSource(vscode, folder);
        if (!staged) {
          return;
        }

        const allowConflicts = await vscode.window.showQuickPick([
          { label: "Fail on conflicts", description: "Recommended", picked: true, allow: false },
          { label: "Allow conflict markers", description: "Write <<<<<<< / >>>>>>> markers into files", allow: true }
        ], { placeHolder: "How should unresolved conflicts be handled?" });
        if (!allowConflicts) {
          await staged.cleanup();
          return;
        }

        try {
          const action = buildPatchMergeQuickAction(staged.patchPath, allowConflicts.allow);
          await previewThenApplyPatch(vscode, binaryPath, folder.uri.fsPath, action, "merge");
        } finally {
          await staged.cleanup();
        }
      }
    },
    {
      label: "Undo last change",
      description: "Restore files from the last patchloom backup",
      detail: "Runs `patchloom undo --apply`",
      run: async () => {
        const folder = await activeWorkspaceFolder({
          promptIfMany: true,
          placeHolder: "Select workspace folder for Patchloom undo"
        });
        if (!folder) {
          await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom undo.");
          return;
        }

        const targetPick = await vscode.window.showQuickPick(
          [
            { label: "Latest backup", description: "Default", picked: true, selection: { kind: "latest" as const } },
            { label: "Backup session", description: "undo --session ID", selection: { kind: "session" as const } },
            { label: "One path", description: "undo --path REL", selection: { kind: "path" as const } }
          ],
          { placeHolder: "Which backup should undo restore?" }
        );
        if (!targetPick) {
          return;
        }

        let undoSelection: UndoSelection = { kind: "latest" };
        if (targetPick.selection.kind === "session") {
          const sessionId = await vscode.window.showInputBox({
            prompt: "Backup session id",
            placeHolder: "session id from patchloom undo --list",
            validateInput: (value) => value.trim().length > 0 ? undefined : "Session id is required."
          });
          if (sessionId === undefined) {
            return;
          }
          undoSelection = { kind: "session", sessionId: sessionId.trim() };
        } else if (targetPick.selection.kind === "path") {
          const relativePath = await vscode.window.showInputBox({
            prompt: "Workspace-relative path to restore",
            placeHolder: "src/app.ts",
            validateInput: (value) => value.trim().length > 0 ? undefined : "Path is required."
          });
          if (relativePath === undefined) {
            return;
          }
          undoSelection = { kind: "path", relativePath: relativePath.trim() };
        }

        const confirm = await vscode.window.showWarningMessage(
          undoSelection.kind === "latest"
            ? "Undo the last patchloom edit? This restores files from backup."
            : `Undo ${undoSelection.kind === "session" ? `session ${undoSelection.sessionId}` : undoSelection.relativePath}? This restores files from backup.`,
          { modal: true },
          "Undo"
        );
        if (confirm !== "Undo") {
          return;
        }

        const action = buildUndoQuickAction(folder.uri.fsPath, undoSelection);
        const result = await executePatchloom(binaryPath, action, folder.uri.fsPath);

        if (result.exitCode !== 0) {
          presentCliResultInOutput(getPatchloomLog(), result);
          await vscode.window.showWarningMessage(formatUndoFailureMessage(result));
          return;
        }

        const log = getPatchloomLog();
        presentUndoSuccess(log, result);
        await vscode.window.showInformationMessage("Patchloom undo complete. Restored files shown in the output channel.");
      }
    }
  ];

  const selection = await vscode.window.showQuickPick(actions, {
    placeHolder: "Select a Patchloom quick action"
  });
  if (!selection) {
    return;
  }

  await selection.run();
}

export function buildReplaceQuickAction(targetPath: string, from: string, to: string): PlannedQuickAction {
  const args = withEndOfOptions(["replace", withOption("--new", to)], [from, targetPath]);
  return {
    title: `Replace text in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildInsertAfterMatchQuickAction(
  targetPath: string,
  pattern: string,
  content: string
): PlannedQuickAction {
  const args = withEndOfOptions(["replace", withOption("--insert-after", content)], [pattern, targetPath]);
  return {
    title: `Insert after match in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildInsertBeforeMatchQuickAction(
  targetPath: string,
  pattern: string,
  content: string
): PlannedQuickAction {
  const args = withEndOfOptions(["replace", withOption("--insert-before", content)], [pattern, targetPath]);
  return {
    title: `Insert before match in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export type ApplyFragmentPlacement = "after" | "before" | "old";

/**
 * Constrained freeform fragment apply (CLI 0.22+). Exactly one of
 * `--after`, `--before`, or `--old` is required by the CLI.
 */
export function buildApplyFragmentQuickAction(
  targetPath: string,
  placement: ApplyFragmentPlacement,
  anchor: string,
  fragment: string
): PlannedQuickAction {
  const flag =
    placement === "after" ? "--after" : placement === "before" ? "--before" : "--old";
  const args = withEndOfOptions(
    ["apply-fragment", withOption(flag, anchor), withOption("--fragment", fragment)],
    [targetPath]
  );
  return {
    title: `Apply fragment in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildTidyQuickAction(targetPath: string, fixes: readonly TidyFix[]): PlannedQuickAction {
  const head = ["tidy", "fix"];
  if (fixes.includes("ensure-final-newline")) {
    head.push("--ensure-final-newline");
  }
  if (fixes.includes("trim-trailing-whitespace")) {
    head.push("--trim-trailing-whitespace");
  }
  if (fixes.includes("normalize-eol-lf")) {
    head.push("--normalize-eol", "lf");
  }
  const args = withEndOfOptions(head, [targetPath]);

  return {
    title: `Tidy ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildDocSetQuickAction(targetPath: string, selector: string, value: string): PlannedQuickAction {
  const args = withEndOfOptions(["doc", "set"], [targetPath, selector, value]);
  return {
    title: `Set ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [3],
    args
  };
}

export function buildDocUpdateQuickAction(targetPath: string, selector: string, value: string): PlannedQuickAction {
  const args = withEndOfOptions(["doc", "update"], [targetPath, selector, value]);
  return {
    title: `Update ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [3],
    args
  };
}

export function buildSearchQuickAction(
  workspacePath: string,
  pattern: string,
  glob?: string,
  options?: { readonly filesWithoutMatch?: boolean }
): PlannedQuickAction {
  const head: string[] = ["search"];
  if (options?.filesWithoutMatch) {
    head.push("--files-without-match");
  }
  if (glob) {
    head.push(withOption("--glob", glob));
  }
  const args = withEndOfOptions(head, [pattern, workspacePath]);
  const targetIndex = args.length - 1;

  return {
    title: options?.filesWithoutMatch
      ? `Search files without "${pattern}"`
      : `Search for "${pattern}"`,
    targetPath: workspacePath,
    targetArgIndices: [targetIndex],
    args
  };
}

export function buildCreateQuickAction(filePath: string, content = ""): PlannedQuickAction {
  const args = withEndOfOptions(["create", withOption("--content", content)], [filePath]);
  return {
    title: `Create ${path.basename(filePath)}`,
    targetPath: filePath,
    targetArgIndices: [args.length - 1],
    args,
    apply: true
  };
}

export function buildAppendQuickAction(targetPath: string, content: string): PlannedQuickAction {
  const args = withEndOfOptions(["append", withOption("--content", content)], [targetPath]);
  return {
    title: `Append to ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildPrependQuickAction(targetPath: string, content: string): PlannedQuickAction {
  const args = withEndOfOptions(["prepend", withOption("--content", content)], [targetPath]);
  return {
    title: `Prepend to ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildDocGetQuickAction(targetPath: string, selector: string): PlannedQuickAction {
  const args = withEndOfOptions(["doc", "get"], [targetPath, selector]);
  return {
    title: `Get ${selector} from ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [3],
    args
  };
}

export function buildDocKeysQuickAction(targetPath: string, selector: string): PlannedQuickAction {
  const args = withEndOfOptions(["doc", "keys"], [targetPath, selector]);
  return {
    title: `Keys at ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [3],
    args
  };
}

export function buildDocLenQuickAction(targetPath: string, selector: string): PlannedQuickAction {
  const args = withEndOfOptions(["doc", "len"], [targetPath, selector]);
  return {
    title: `Length of ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [3],
    args
  };
}

export function buildDocDeleteQuickAction(targetPath: string, selector: string): PlannedQuickAction {
  const args = withEndOfOptions(["doc", "delete"], [targetPath, selector]);
  return {
    title: `Delete ${selector} from ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [3],
    args
  };
}

export function buildDocDeleteWhereQuickAction(
  targetPath: string,
  selector: string,
  predicate: string
): PlannedQuickAction {
  return {
    title: `Delete where ${predicate} from ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [4],
    args: withEndOfOptions(["doc", "delete-where", withOption("--predicate", predicate)], [targetPath, selector])
  };
}

export function buildDocMergeQuickAction(
  targetPath: string,
  value: string,
  selector?: string
): PlannedQuickAction {
  const trimmedSelector = selector?.trim() ?? "";
  const head = ["doc", "merge"];
  if (trimmedSelector.length > 0) {
    head.push(withOption("--selector", trimmedSelector));
  }
  head.push(withOption("--value", value));
  const args = withEndOfOptions(head, [targetPath]);

  const title = trimmedSelector.length > 0
    ? `Merge into ${trimmedSelector} in ${path.basename(targetPath)}`
    : `Merge into ${path.basename(targetPath)}`;

  return {
    title,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildDocAppendQuickAction(targetPath: string, selector: string, value: string): PlannedQuickAction {
  return {
    title: `Append to ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [3],
    args: withEndOfOptions(["doc", "append"], [targetPath, selector, value])
  };
}

export function buildMdTableAppendQuickAction(targetPath: string, heading: string, row: string): PlannedQuickAction {
  const args = withEndOfOptions(
    ["md", "table-append", withOption("--heading", heading), withOption("--row", row)],
    [targetPath]
  );
  return {
    title: `Append table row under "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildMdUpsertBulletQuickAction(targetPath: string, heading: string, bullet: string): PlannedQuickAction {
  const args = withEndOfOptions(
    ["md", "upsert-bullet", withOption("--heading", heading), withOption("--bullet", bullet)],
    [targetPath]
  );
  return {
    title: `Upsert bullet under "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildMdReplaceSectionQuickAction(targetPath: string, heading: string, content: string): PlannedQuickAction {
  const args = withEndOfOptions(
    ["md", "replace-section", withOption("--heading", heading), withOption("--content", content)],
    [targetPath]
  );
  return {
    title: `Replace "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildDocPrependQuickAction(targetPath: string, selector: string, value: string): PlannedQuickAction {
  return {
    title: `Prepend to ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [3],
    args: withEndOfOptions(["doc", "prepend"], [targetPath, selector, value])
  };
}

export function buildDocEnsureQuickAction(targetPath: string, selector: string, value: string): PlannedQuickAction {
  return {
    title: `Ensure ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [3],
    args: withEndOfOptions(["doc", "ensure"], [targetPath, selector, value])
  };
}

export function buildDocMoveQuickAction(targetPath: string, from: string, to: string): PlannedQuickAction {
  return {
    title: `Move ${from} to ${to} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [3],
    args: withEndOfOptions(["doc", "move"], [targetPath, from, to])
  };
}

export function buildMdInsertAfterHeadingQuickAction(targetPath: string, heading: string, content: string): PlannedQuickAction {
  const args = withEndOfOptions(
    ["md", "insert-after-heading", withOption("--heading", heading), withOption("--content", content)],
    [targetPath]
  );
  return {
    title: `Insert after "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildMdInsertAfterSectionQuickAction(targetPath: string, heading: string, content: string): PlannedQuickAction {
  const args = withEndOfOptions(
    ["md", "insert-after-section", withOption("--heading", heading), withOption("--content", content)],
    [targetPath]
  );
  return {
    title: `Insert after section "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildMdInsertBeforeHeadingQuickAction(targetPath: string, heading: string, content: string): PlannedQuickAction {
  const args = withEndOfOptions(
    ["md", "insert-before-heading", withOption("--heading", heading), withOption("--content", content)],
    [targetPath]
  );
  return {
    title: `Insert before "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [args.length - 1],
    args
  };
}

export function buildPatchApplyQuickAction(patchPath: string): PlannedQuickAction {
  const args = withEndOfOptions(["patch", "apply", "--json"], [patchPath]);
  return {
    title: `Apply patch ${path.basename(patchPath)}`,
    targetPath: patchPath,
    targetArgIndices: [args.length - 1],
    args,
    apply: true
  };
}

export function buildPatchMergeQuickAction(patchPath: string, allowConflicts: boolean): PlannedQuickAction {
  const head = ["patch", "merge"];
  if (allowConflicts) {
    head.push("--allow-conflicts");
  }
  head.push("--json");
  const args = withEndOfOptions(head, [patchPath]);
  return {
    title: `Merge patch ${path.basename(patchPath)}`,
    targetPath: patchPath,
    targetArgIndices: [args.length - 1],
    args,
    apply: true
  };
}

export function buildUndoQuickAction(
  workspacePath: string,
  selection: UndoSelection = { kind: "latest" }
): PlannedQuickAction {
  const title = selection.kind === "session"
    ? `Undo session ${selection.sessionId}`
    : selection.kind === "path"
      ? `Undo ${selection.relativePath}`
      : "Undo last patchloom change";
  return {
    title,
    targetPath: workspacePath,
    targetArgIndices: [],
    args: buildUndoArgs(selection),
    apply: true
  };
}

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isEnvDocumentPath(filePath: string): boolean {
  const base = path.basename(filePath);
  return base === ".env" || base.startsWith(".env.");
}

export function isStructuredDocumentPath(filePath: string): boolean {
  if (STRUCTURED_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return true;
  }
  return isEnvDocumentPath(filePath);
}

export function isAllowedPreviewMiss(action: PlannedQuickAction, exitCode: number): boolean {
  if (exitCode !== 3) {
    return false;
  }
  // PlannedQuickAction.args are operands only. executePatchloom adds --contain.
  // Exit 3 is a soft no-op for text replace (pattern not in the file).
  // It is a real miss when an anchor or heading was not found: markdown
  // section ops, apply-fragment, and insert-before / insert-after.
  // Same for doc update, delete-where, append, prepend, merge, and move.
  if (action.args[0] === "md" || action.args[0] === "apply-fragment") {
    return false;
  }
  if (action.args.some((arg) => arg.startsWith("--insert-before=") || arg.startsWith("--insert-after="))) {
    return false;
  }
  if (
    action.args[0] === "doc" &&
    (action.args[1] === "update" ||
      action.args[1] === "delete-where" ||
      action.args[1] === "append" ||
      action.args[1] === "prepend" ||
      action.args[1] === "merge" ||
      action.args[1] === "move")
  ) {
    return false;
  }
  return true;
}

export type PreviewMissReason = "pattern-not-found" | "unchanged";

export function previewMissMessage(
  action: PlannedQuickAction,
  relativePath: string,
  reason: PreviewMissReason = "pattern-not-found"
): string {
  if (action.args[0] === "doc" && action.args[1] === "delete-where") {
    return `No items matched that predicate in ${relativePath}. Check the array path (for example items) versus the key=value predicate (for example name=stale).`;
  }
  const patternSearch = action.args[0] === "replace"
    || action.args.some((arg) => arg.startsWith("--insert-before=") || arg.startsWith("--insert-after="));
  if (reason === "pattern-not-found" && patternSearch) {
    return `Pattern not found in ${relativePath}.`;
  }
  return `Command made no edit to ${relativePath}.`;
}

export function retargetQuickAction(action: PlannedQuickAction, nextTargetPath: string): PlannedQuickAction {
  return {
    ...action,
    targetPath: nextTargetPath,
    args: action.args.map((arg, index) => action.targetArgIndices.includes(index) ? nextTargetPath : arg)
  };
}



async function previewAndMaybeApply(
  binaryPath: string,
  target: WorkspaceFileTarget,
  action: PlannedQuickAction
): Promise<void> {
  const vscode = await import("vscode");
  if (!isRealPathInsideWorkspace(target.workspaceFolder.uri.fsPath, target.absolutePath)) {
    await vscode.window.showWarningMessage(
      `Refusing to preview ${target.relativePath}: resolved path is outside the workspace folder.`
    );
    return;
  }
  const originalDocument = await vscode.workspace.openTextDocument(target.uri);
  const originalContent = await fs.readFile(target.absolutePath, "utf8");
  if (!previewSnapshotStillCurrent(originalContent, originalDocument.getText(), originalContent)) {
    await vscode.window.showWarningMessage(
      `Save unsaved edits to ${target.relativePath} before previewing. The preview reads the file on disk.`
    );
    return;
  }
  let preview: VSCode.TextDocument | undefined;
  try {
    const built = await buildPreviewDocument(
      binaryPath,
      action,
      originalContent,
      originalDocument.languageId,
      target.workspaceFolder.uri.fsPath
    );
    if (built.kind === "miss") {
      await vscode.window.showInformationMessage(
        previewMissMessage(action, target.relativePath, built.reason)
      );
      return;
    }
    preview = built.document;
  } catch (error) {
    getPatchloomLog()?.show();
    await vscode.window.showErrorMessage(
      `Patchloom failed while previewing changes to ${target.relativePath}: ${formatError(error)}`
    );
    return;
  }

  await vscode.commands.executeCommand(
    "vscode.diff",
    target.uri,
    preview.uri,
    `${action.title} (Patchloom preview)`
  );

  const choice = await vscode.window.showInformationMessage(
    `Preview ready for ${target.relativePath}. Apply these changes?`,
    "Apply Changes"
  );
  if (choice !== "Apply Changes") {
    return;
  }
  const diskNow = await fs.readFile(target.absolutePath, "utf8");
  if (!previewSnapshotStillCurrent(originalContent, originalDocument.getText(), diskNow)) {
    await vscode.window.showWarningMessage(
      `${target.relativePath} changed after the preview. Preview again before applying.`
    );
    return;
  }

  const result = await executePatchloom(
    binaryPath,
    { args: action.args, apply: true },
    target.workspaceFolder.uri.fsPath
  );
  if (result.exitCode !== 0) {
    presentCliResultInOutput(getPatchloomLog(), result);
    await vscode.window.showErrorMessage(
      `Patchloom failed while applying changes to ${target.relativePath}: ${formatQuickActionCliOutput(result)}`
    );
    return;
  }

  const document = await vscode.workspace.openTextDocument(target.uri);
  await vscode.window.showTextDocument(document, { preview: false });
  const { refreshStatusBar } = await import("../status/statusBar.js");
  await refreshStatusBar();
  await vscode.window.showInformationMessage(`Applied Patchloom quick action to ${target.relativePath}.`);
}

async function buildPreviewDocument(
  binaryPath: string,
  action: PlannedQuickAction,
  originalContent: string,
  languageId: string,
  workspaceRoot: string
): Promise<
  | { readonly kind: "document"; readonly document: VSCode.TextDocument }
  | { readonly kind: "miss"; readonly reason: PreviewMissReason }
> {
  const vscode = await import("vscode");
  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const location = previewWorkspaceFile(workspaceRoot, action.targetPath, nonce);
  const cwd = previewCwd(workspaceRoot);
  const backupsBefore = await backupSessionNames(workspaceRoot);

  try {
    await fs.mkdir(location.directory, { recursive: true });
    await fs.writeFile(location.filePath, originalContent, "utf8");
    const previewAction = retargetQuickAction(action, location.filePath);
    const result = await executePatchloom(binaryPath, { args: previewAction.args, apply: true }, cwd);
    if (result.exitCode !== 0 && !isAllowedPreviewMiss(action, result.exitCode)) {
      presentCliResultInOutput(getPatchloomLog(), result);
      throw new Error(formatQuickActionCliOutput(result));
    }

    const previewContent = await fs.readFile(location.filePath, "utf8");
    if (result.exitCode === 3 && isAllowedPreviewMiss(action, result.exitCode)) {
      return { kind: "miss", reason: "pattern-not-found" };
    }
    if (previewContent === originalContent) {
      return { kind: "miss", reason: "unchanged" };
    }

    const id = rememberPreviewBody(previewContent);
    const uri = vscode.Uri.from({ scheme: PATCHLOOM_PREVIEW_SCHEME, path: `/${id}` });
    const document = await vscode.workspace.openTextDocument(uri);
    if (languageId.length > 0) {
      try {
        await vscode.languages.setTextDocumentLanguage(document, languageId);
      } catch {
        // The preview body is already stored. A missing language id should not drop it.
      }
    }
    return { kind: "document", document };
  } finally {
    try {
      await fs.rm(location.directory, { recursive: true, force: true });
    } catch {
      // The preview body is already stored.
    }
    try {
      await removePreviewBackupSessions(workspaceRoot, backupsBefore, nonce);
    } catch {
      // Leave sessions we could not prove belong to this preview.
    }
  }
}

async function pickStructuredDocumentTarget(opLabel: string): Promise<WorkspaceFileTarget | undefined> {
  const target = await pickWorkspaceFileTarget(
    `Select a ${STRUCTURED_DOCUMENT_LABEL} file for Patchloom ${opLabel}`
  );
  if (!target) {
    return undefined;
  }
  if (!isStructuredDocumentPath(target.absolutePath)) {
    const vscode = await import("vscode");
    await vscode.window.showWarningMessage(
      `${target.relativePath} is not a supported ${STRUCTURED_DOCUMENT_LABEL} file for Patchloom ${opLabel}.`
    );
    return undefined;
  }
  return target;
}

async function pickWorkspaceFileTarget(placeHolder: string): Promise<WorkspaceFileTarget | undefined> {
  const vscode = await import("vscode");
  const folder = await activeWorkspaceFolder({
    promptIfMany: true,
    placeHolder
  });
  if (!folder) {
    await vscode.window.showWarningMessage("Open a workspace folder before running Patchloom quick actions.");
    return undefined;
  }

  const environment = describeWorkspaceEnvironment(vscode.env.remoteName);
  if (environment.support === "unverified") {
    await vscode.window.showWarningMessage(
      `${environment.label} is not explicitly verified for Patchloom quick actions. Proceed carefully.`
    );
  }

  const activeTarget = await activeEditorTarget(folder);
  const options: Array<VSCode.QuickPickItem & { target?: WorkspaceFileTarget; input?: true }> = [];
  if (activeTarget) {
    options.push({
      label: "Active file",
      description: activeTarget.relativePath,
      detail: "Use the file from the focused editor",
      target: activeTarget
    });
  }
  options.push({
    label: "Enter workspace path",
    description: folder.name,
    detail: "Type a path relative to the current workspace folder",
    input: true
  });

  const selection = await vscode.window.showQuickPick(options, { placeHolder });
  if (!selection) {
    return undefined;
  }

  const target = selection.target ?? await inputWorkspaceFileTarget(folder);
  if (!target) {
    return undefined;
  }

  if (!isRealPathInsideWorkspace(folder.uri.fsPath, target.absolutePath)) {
    await vscode.window.showWarningMessage(
      `Refusing ${target.relativePath}: resolved path is outside the workspace folder.`
    );
    return undefined;
  }

  return (await ensureWorkspaceFileReady(target)) ? target : undefined;
}

async function activeEditorTarget(folder: VSCode.WorkspaceFolder): Promise<WorkspaceFileTarget | undefined> {
  const vscode = await import("vscode");
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (!activeUri || activeUri.scheme !== "file") {
    return undefined;
  }

  try {
    return toWorkspaceFileTarget(folder, activeUri.fsPath);
  } catch {
    return undefined;
  }
}

async function inputWorkspaceFileTarget(folder: VSCode.WorkspaceFolder): Promise<WorkspaceFileTarget | undefined> {
  const vscode = await import("vscode");
  const entered = await vscode.window.showInputBox({
    prompt: `Path relative to ${folder.name}`,
    placeHolder: "src/example.ts",
    validateInput: (value) => value.trim().length > 0 ? undefined : "Path is required."
  });
  if (entered === undefined) {
    return undefined;
  }

  try {
    return toWorkspaceFileTarget(folder, path.resolve(folder.uri.fsPath, entered.trim()));
  } catch (error) {
    await vscode.window.showWarningMessage(formatError(error));
    return undefined;
  }
}

export interface StagedExternalPatch {
  readonly patchPath: string;
  readonly cleanup: () => Promise<void>;
}

/** Copy an outside patch into a workspace temp dir so `--contain` can stay on. */
export async function stageExternalPatchInWorkspace(
  workspaceRoot: string,
  patchPath: string
): Promise<StagedExternalPatch> {
  // Keep only patches whose real path is inside the workspace. A workspace
  // symlink to an outside .patch must be copied so --contain stays on.
  if (isRealPathInsideWorkspace(workspaceRoot, patchPath)) {
    return { patchPath, cleanup: async () => {} };
  }

  // `.gitignore` ignores `.patchloom/` only. A sibling `.patchloom-*` directory
  // shows up in source control for the whole preview, and stays if VS Code quits
  // before cleanup.
  const scratch = path.join(workspaceRoot, ".patchloom");
  await fs.mkdir(scratch, { recursive: true });
  const tempDir = await fs.mkdtemp(path.join(scratch, "qa-patch-"));
  const stagedPath = path.join(tempDir, path.basename(patchPath));
  try {
    await fs.copyFile(patchPath, stagedPath);
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }
  return {
    patchPath: stagedPath,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  };
}

function toWorkspaceFileTarget(folder: VSCode.WorkspaceFolder, absolutePath: string): WorkspaceFileTarget {
  const relativePath = resolveWorkspaceRelativePath(folder.uri.fsPath, absolutePath);

  return {
    workspaceFolder: folder,
    absolutePath: path.resolve(absolutePath),
    relativePath,
    uri: folder.uri.with({ path: path.posix.join(folder.uri.path, relativePath) })
  };
}

async function ensureWorkspaceFileReady(target: WorkspaceFileTarget): Promise<boolean> {
  const vscode = await import("vscode");
  let stat;
  try {
    stat = await fs.stat(target.absolutePath);
  } catch {
    await vscode.window.showWarningMessage(
      `File not found: ${target.relativePath}. Use Create a new file, or pick an existing file.`
    );
    return false;
  }

  if (!stat.isFile()) {
    await vscode.window.showWarningMessage(`Patchloom quick actions currently target files only: ${target.relativePath}`);
    return false;
  }

  const openDocument = vscode.workspace.textDocuments.find((document) => sameRealFilePath(document.uri.fsPath, target.absolutePath));
  if (openDocument?.isDirty) {
    const choice = await vscode.window.showWarningMessage(
      `${target.relativePath} has unsaved changes. Save it before running Patchloom quick actions.`,
      "Save and Continue"
    );
    if (choice !== "Save and Continue") {
      return false;
    }
    if (!(await openDocument.save())) {
      return false;
    }
  }

  return true;
}

async function executePatchloom(
  binaryPath: string,
  invocation: PatchloomInvocation,
  cwd: string
): Promise<PatchloomCommandResult> {
  const finalArgs = serializePatchloomArgs({
    args: invocation.args,
    apply: invocation.apply,
    contain: invocation.contain !== false
  });
  const log = getPatchloomLog();
  const runtime = await getPatchloomRuntimeConfig();
  const env = mergePatchloomEnv(process.env, runtime.extraEnv);
  logCliCommand(log, runtime.trace, binaryPath, finalArgs, cwd);

  try {
    const { stdout, stderr } = await execPatchloomFile(binaryPath, finalArgs, {
      cwd,
      env,
      timeout: PATCHLOOM_CLI_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    });
    const result: PatchloomCommandResult = { exitCode: 0, stdout, stderr };
    logCliResult(log, runtime.trace, result.exitCode, result.stdout, result.stderr);
    return result;
  } catch (error) {
    const result = cliResultFromExecError(error);
    logCliResult(log, runtime.trace, result.exitCode, result.stdout, result.stderr);
    return result;
  }
}

/**
 * Node's `execFile` timeout sets `code` to null and `signal` to SIGTERM,
 * while still filling stdout and stderr. A numeric `code` is the CLI exit.
 */
export function cliResultFromExecError(error: unknown): PatchloomCommandResult {
  if (!(error instanceof Error)) {
    return { exitCode: 1, stdout: "", stderr: formatError(error) };
  }

  const candidate = error as Error & {
    code?: number | string | null;
    stdout?: unknown;
    stderr?: unknown;
    exitCode?: number;
  };
  const stdout = typeof candidate.stdout === "string" ? candidate.stdout : "";
  const stderrText = typeof candidate.stderr === "string" ? candidate.stderr : "";
  const exitCode = typeof candidate.code === "number"
    ? candidate.code
    : typeof candidate.exitCode === "number"
      ? candidate.exitCode
      : 1;
  return {
    exitCode,
    stdout,
    stderr: stderrText.length > 0 ? stderrText : candidate.message
  };
}
