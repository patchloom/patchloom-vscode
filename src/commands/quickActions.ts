import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type * as VSCode from "vscode";
import { ensurePatchloomReadyOrNotify } from "../binary/patchloom.js";
import {
  getPatchloomLog,
  getPatchloomRuntimeConfig,
  logCliCommand,
  logCliResult,
  presentCliResultInOutput,
  type PatchloomLog
} from "../logging/outputChannel.js";
import { formatCliOutput, formatError, mergePatchloomEnv } from "../util.js";
import { activeWorkspaceFolder, describeWorkspaceEnvironment } from "../workspace/readiness.js";

const execFileAsync = promisify(execFile);
const STRUCTURED_FILE_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml"]);
const MARKDOWN_FILE_EXTENSIONS = new Set([".md", ".markdown", ".mdx"]);

export type TidyFix = "ensure-final-newline" | "trim-trailing-whitespace" | "normalize-eol-lf";

export interface PlannedQuickAction {
  readonly title: string;
  readonly targetPath: string;
  readonly targetArgIndices: readonly number[];
  readonly args: readonly string[];
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
          validateInput: (value) => value.length > 0 ? undefined : "Search text is required."
        });
        if (from === undefined) {
          return;
        }

        const to = await vscode.window.showInputBox({
          prompt: "Replacement text",
          placeHolder: "new_name"
        });
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
          validateInput: (value) => value.length > 0 ? undefined : "Match text is required."
        });
        if (pattern === undefined) {
          return;
        }

        const content = await vscode.window.showInputBox({
          prompt: "Text to insert after each match",
          placeHolder: "new_line_or_token"
        });
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
          validateInput: (value) => value.length > 0 ? undefined : "Match text is required."
        });
        if (pattern === undefined) {
          return;
        }

        const content = await vscode.window.showInputBox({
          prompt: "Text to insert before each match",
          placeHolder: "new_line_or_token"
        });
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
          validateInput: (value) => value.length > 0 ? undefined : "Anchor text is required."
        });
        if (anchor === undefined) {
          return;
        }

        const fragment = await vscode.window.showInputBox({
          prompt: "Fragment text (Morph-style // ... existing code ... markers are stripped)",
          placeHolder: "  let x = 1;"
        });
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
      description: "Update JSON, YAML, or TOML with diff preview",
      detail: "Builds `patchloom doc set <file> <selector> <value>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a JSON, YAML, or TOML file for Patchloom doc set");
        if (!target) {
          return;
        }

        if (!isStructuredDocumentPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a supported JSON, YAML, or TOML file for Patchloom doc set.`
          );
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

        const value = await vscode.window.showInputBox({
          prompt: "Value",
          placeHolder: "true, 42, hello, or {\"key\":\"value\"}",
          value: "",
          validateInput: (input) => input.length > 0 ? undefined : "Value is required."
        });
        if (value === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildDocSetQuickAction(target.absolutePath, selector, value));
      }
    },
    {
      label: "Update matching structured values",
      description: "Update all JSON, YAML, or TOML nodes matching a wildcard or predicate",
      detail: "Builds `patchloom doc update <file> <selector> <value>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a JSON, YAML, or TOML file for Patchloom doc update");
        if (!target) {
          return;
        }

        if (!isStructuredDocumentPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a supported JSON, YAML, or TOML file for Patchloom doc update.`
          );
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Selector path (wildcards and predicates such as items[*].enabled)",
          placeHolder: "items[*].enabled or items[name=foo].v",
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        const value = await vscode.window.showInputBox({
          prompt: "Value",
          placeHolder: "true, 42, hello, or {\"key\":\"value\"}",
          value: "",
          validateInput: (input) => input.length > 0 ? undefined : "Value is required."
        });
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
        const result = await executePatchloom(binaryPath, action.args, folder.uri.fsPath);
        const log = getPatchloomLog();
        const outcome = presentSearchOutcome(log, result);

        if (outcome === "none") {
          await vscode.window.showInformationMessage(`No matches found for "${pattern}".`);
        } else if (outcome === "error") {
          await vscode.window.showErrorMessage(`Patchloom search failed: ${formatCliOutput(result)}`);
        } else {
          await vscode.window.showInformationMessage("Search results displayed in the Patchloom output channel.");
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
        const result = await executePatchloom(binaryPath, action.args, folder.uri.fsPath);
        const log = getPatchloomLog();
        const outcome = presentSearchOutcome(log, result);

        if (outcome === "none") {
          await vscode.window.showInformationMessage(`Every scanned file contains "${pattern}".`);
        } else if (outcome === "error") {
          await vscode.window.showErrorMessage(`Patchloom search failed: ${formatCliOutput(result)}`);
        } else {
          await vscode.window.showInformationMessage(
            "Files without matches are listed in the Patchloom output channel."
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
        const content = await vscode.window.showInputBox({
          prompt: "Initial file content (leave empty for an empty file)",
          placeHolder: "// new file"
        });
        if (content === undefined) {
          return;
        }

        const action = buildCreateQuickAction(absolutePath, content);
        const result = await executePatchloom(binaryPath, action.args, folder.uri.fsPath);

        if (result.exitCode !== 0) {
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

        const content = await vscode.window.showInputBox({
          prompt: "Content to append",
          placeHolder: "new line of text",
          validateInput: (value) => value.length > 0 ? undefined : "Content is required."
        });
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

        const content = await vscode.window.showInputBox({
          prompt: "Content to prepend",
          placeHolder: "// header comment",
          validateInput: (value) => value.length > 0 ? undefined : "Content is required."
        });
        if (content === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildPrependQuickAction(target.absolutePath, content));
      }
    },
    {
      label: "Read structured value",
      description: "Read a value from JSON, YAML, or TOML",
      detail: "Builds `patchloom doc get <file> <selector>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a JSON, YAML, or TOML file for Patchloom doc get");
        if (!target) {
          return;
        }

        if (!isStructuredDocumentPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a supported JSON, YAML, or TOML file for Patchloom doc get.`
          );
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
        const result = await executePatchloom(binaryPath, action.args, target.workspaceFolder.uri.fsPath);

        if (result.exitCode !== 0) {
          await vscode.window.showErrorMessage(`Patchloom doc get failed: ${formatCliOutput(result)}`);
          return;
        }

        const value = result.stdout.trim();
        await vscode.env.clipboard.writeText(value);
        await vscode.window.showInformationMessage(`${selector} = ${value} (copied to clipboard)`);
      }
    },
    {
      label: "Delete structured value",
      description: "Remove a key from JSON, YAML, or TOML with diff preview",
      detail: "Builds `patchloom doc delete <file> <selector>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a JSON, YAML, or TOML file for Patchloom doc delete");
        if (!target) {
          return;
        }

        if (!isStructuredDocumentPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a supported JSON, YAML, or TOML file for Patchloom doc delete.`
          );
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
        const target = await pickWorkspaceFileTarget(
          "Select a JSON, YAML, or TOML file for Patchloom doc delete-where"
        );
        if (!target) {
          return;
        }

        if (!isStructuredDocumentPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a supported JSON, YAML, or TOML file for Patchloom doc delete-where.`
          );
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Array selector path",
          placeHolder: "items",
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        const predicate = await vscode.window.showInputBox({
          prompt: "Predicate (key=value)",
          placeHolder: "name=react or .=stale",
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
        const target = await pickWorkspaceFileTarget("Select a JSON, YAML, or TOML file for Patchloom doc merge");
        if (!target) {
          return;
        }

        if (!isStructuredDocumentPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a supported JSON, YAML, or TOML file for Patchloom doc merge.`
          );
          return;
        }

        const selector = await vscode.window.showInputBox({
          prompt: "Merge selector (optional). Multi-document YAML needs a document index (CLI 0.16+)",
          placeHolder: "leave empty for root, or 0 / [0] for the first multi-doc document"
        });
        if (selector === undefined) {
          return;
        }

        const value = await vscode.window.showInputBox({
          prompt: "Partial JSON object to merge",
          placeHolder: '{"debug": true, "logLevel": "verbose"}',
          validateInput: (input) => input.length > 0 ? undefined : "Value is required."
        });
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
      description: "Append a value to a JSON, YAML, or TOML array",
      detail: "Builds `patchloom doc append <file> <selector> <value>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a JSON, YAML, or TOML file for Patchloom doc append");
        if (!target) {
          return;
        }

        if (!isStructuredDocumentPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a supported JSON, YAML, or TOML file for Patchloom doc append.`
          );
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

        const value = await vscode.window.showInputBox({
          prompt: "Value to append",
          placeHolder: '"new-item"',
          validateInput: (input) => input.length > 0 ? undefined : "Value is required."
        });
        if (value === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildDocAppendQuickAction(target.absolutePath, selector, value));
      }
    },
    {
      label: "Prepend to array",
      description: "Prepend a value to a JSON, YAML, or TOML array",
      detail: "Builds `patchloom doc prepend <file> <selector> <value>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a JSON, YAML, or TOML file for Patchloom doc prepend");
        if (!target) {
          return;
        }

        if (!isStructuredDocumentPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a supported JSON, YAML, or TOML file for Patchloom doc prepend.`
          );
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

        const value = await vscode.window.showInputBox({
          prompt: "Value to prepend",
          placeHolder: '"new-item"',
          validateInput: (input) => input.length > 0 ? undefined : "Value is required."
        });
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
        const target = await pickWorkspaceFileTarget("Select a JSON, YAML, or TOML file for Patchloom doc ensure");
        if (!target) {
          return;
        }

        if (!isStructuredDocumentPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a supported JSON, YAML, or TOML file for Patchloom doc ensure.`
          );
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

        const value = await vscode.window.showInputBox({
          prompt: "Default value (set only if missing)",
          placeHolder: "8080",
          validateInput: (input) => input.length > 0 ? undefined : "Value is required."
        });
        if (value === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildDocEnsureQuickAction(target.absolutePath, selector, value));
      }
    },
    {
      label: "Move/rename key",
      description: "Move or rename a selector path in JSON, YAML, or TOML",
      detail: "Builds `patchloom doc move <file> <from> <to>`",
      run: async () => {
        const target = await pickWorkspaceFileTarget("Select a JSON, YAML, or TOML file for Patchloom doc move");
        if (!target) {
          return;
        }

        if (!isStructuredDocumentPath(target.absolutePath)) {
          await vscode.window.showWarningMessage(
            `${target.relativePath} is not a supported JSON, YAML, or TOML file for Patchloom doc move.`
          );
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

        const content = await vscode.window.showInputBox({
          prompt: "Content to insert",
          placeHolder: "New paragraph text",
          validateInput: (value) => value.length > 0 ? undefined : "Content is required."
        });
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

        const content = await vscode.window.showInputBox({
          prompt: "Sibling content to insert after the section body",
          placeHolder: "## FAQ\n\nCommon questions.",
          validateInput: (value) => value.length > 0 ? undefined : "Content is required."
        });
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

        const content = await vscode.window.showInputBox({
          prompt: "Content to insert",
          placeHolder: "New section text",
          validateInput: (value) => value.length > 0 ? undefined : "Content is required."
        });
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

        const row = await vscode.window.showInputBox({
          prompt: "Table row to append (pipe-delimited)",
          placeHolder: "| /users | List users | GET |",
          validateInput: (value) => value.length > 0 ? undefined : "Row is required."
        });
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

        const bullet = await vscode.window.showInputBox({
          prompt: "Bullet text (without leading dash)",
          placeHolder: "Run make check before committing",
          validateInput: (value) => value.length > 0 ? undefined : "Bullet text is required."
        });
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

        const content = await vscode.window.showInputBox({
          prompt: "New section content",
          placeHolder: "- New feature added",
          validateInput: (value) => value.length > 0 ? undefined : "Content is required."
        });
        if (content === undefined) {
          return;
        }

        await previewAndMaybeApply(binaryPath, target, buildMdReplaceSectionQuickAction(target.absolutePath, heading, content));
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

        const patchUri = await vscode.window.showOpenDialog({
          canSelectMany: false,
          defaultUri: folder.uri,
          filters: { "Patch files": ["patch", "diff"], "All files": ["*"] },
          openLabel: "Select Patch"
        });
        if (!patchUri || patchUri.length === 0) {
          return;
        }

        const allowConflicts = await vscode.window.showQuickPick([
          { label: "Fail on conflicts", description: "Recommended", picked: true, allow: false },
          { label: "Allow conflict markers", description: "Write <<<<<<< / >>>>>>> markers into files", allow: true }
        ], { placeHolder: "How should unresolved conflicts be handled?" });
        if (!allowConflicts) {
          return;
        }

        const action = buildPatchMergeQuickAction(patchUri[0].fsPath, allowConflicts.allow);
        // External patch files are meta-inputs; --contain rejects them. Keep the
        // write sandbox when the patch itself lives inside the workspace.
        const contain = isPathInsideWorkspace(folder.uri.fsPath, patchUri[0].fsPath);
        const result = await executePatchloom(binaryPath, action.args, folder.uri.fsPath, { contain });
        const log = getPatchloomLog();
        const outcome = presentPatchMergeOutcome(log, result);

        if (outcome === "conflicts") {
          await vscode.window.showWarningMessage("Patch merge completed with unresolved conflicts. Check the output for details.");
        } else if (outcome === "error") {
          await vscode.window.showErrorMessage(`Patch merge failed: ${formatCliOutput(result)}`);
        } else {
          await vscode.window.showInformationMessage("Patch merged successfully.");
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

        const confirm = await vscode.window.showWarningMessage(
          "Undo the last patchloom edit? This restores files from backup.",
          { modal: true },
          "Undo"
        );
        if (confirm !== "Undo") {
          return;
        }

        const action = buildUndoQuickAction(folder.uri.fsPath);
        const result = await executePatchloom(binaryPath, action.args, folder.uri.fsPath);

        if (result.exitCode !== 0) {
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
  return {
    title: `Replace text in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [4],
    args: ["replace", from, "--new", to, targetPath]
  };
}

export function buildInsertAfterMatchQuickAction(
  targetPath: string,
  pattern: string,
  content: string
): PlannedQuickAction {
  return {
    title: `Insert after match in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [4],
    args: ["replace", pattern, "--insert-after", content, targetPath]
  };
}

export function buildInsertBeforeMatchQuickAction(
  targetPath: string,
  pattern: string,
  content: string
): PlannedQuickAction {
  return {
    title: `Insert before match in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [4],
    args: ["replace", pattern, "--insert-before", content, targetPath]
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
  return {
    title: `Apply fragment in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [1],
    args: ["apply-fragment", targetPath, flag, anchor, "--fragment", fragment]
  };
}

export function buildTidyQuickAction(targetPath: string, fixes: readonly TidyFix[]): PlannedQuickAction {
  const args = ["tidy", "fix", targetPath];
  if (fixes.includes("ensure-final-newline")) {
    args.push("--ensure-final-newline");
  }
  if (fixes.includes("trim-trailing-whitespace")) {
    args.push("--trim-trailing-whitespace");
  }
  if (fixes.includes("normalize-eol-lf")) {
    args.push("--normalize-eol", "lf");
  }

  return {
    title: `Tidy ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args
  };
}

export function buildDocSetQuickAction(targetPath: string, selector: string, value: string): PlannedQuickAction {
  return {
    title: `Set ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["doc", "set", targetPath, selector, value]
  };
}

export function buildDocUpdateQuickAction(targetPath: string, selector: string, value: string): PlannedQuickAction {
  return {
    title: `Update ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["doc", "update", targetPath, selector, value]
  };
}

export function buildSearchQuickAction(
  workspacePath: string,
  pattern: string,
  glob?: string,
  options?: { readonly filesWithoutMatch?: boolean }
): PlannedQuickAction {
  const args: string[] = ["search", pattern];
  if (options?.filesWithoutMatch) {
    args.push("--files-without-match");
  }
  if (glob) {
    args.push("--glob", glob);
  }
  args.push(workspacePath);
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
  return {
    title: `Create ${path.basename(filePath)}`,
    targetPath: filePath,
    targetArgIndices: [1],
    // CLI requires --content/--stdin and --apply; preview-only create returns exit 2 and does not write.
    args: ["create", filePath, "--content", content, "--apply"]
  };
}

export function buildAppendQuickAction(targetPath: string, content: string): PlannedQuickAction {
  return {
    title: `Append to ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [1],
    args: ["append", targetPath, "--content", content]
  };
}

export function buildPrependQuickAction(targetPath: string, content: string): PlannedQuickAction {
  return {
    title: `Prepend to ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [1],
    args: ["prepend", targetPath, "--content", content]
  };
}

export function buildDocGetQuickAction(targetPath: string, selector: string): PlannedQuickAction {
  return {
    title: `Get ${selector} from ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["doc", "get", targetPath, selector]
  };
}

export function buildDocDeleteQuickAction(targetPath: string, selector: string): PlannedQuickAction {
  return {
    title: `Delete ${selector} from ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["doc", "delete", targetPath, selector]
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
    args: ["doc", "delete-where", "--predicate", predicate, targetPath, selector]
  };
}

export function buildDocMergeQuickAction(
  targetPath: string,
  value: string,
  selector?: string
): PlannedQuickAction {
  const trimmedSelector = selector?.trim() ?? "";
  const args = ["doc", "merge", targetPath];
  if (trimmedSelector.length > 0) {
    args.push("--selector", trimmedSelector);
  }
  args.push("--value", value);

  const title = trimmedSelector.length > 0
    ? `Merge into ${trimmedSelector} in ${path.basename(targetPath)}`
    : `Merge into ${path.basename(targetPath)}`;

  return {
    title,
    targetPath,
    targetArgIndices: [2],
    args
  };
}

export function buildDocAppendQuickAction(targetPath: string, selector: string, value: string): PlannedQuickAction {
  return {
    title: `Append to ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["doc", "append", targetPath, selector, value]
  };
}

export function buildMdTableAppendQuickAction(targetPath: string, heading: string, row: string): PlannedQuickAction {
  return {
    title: `Append table row under "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["md", "table-append", targetPath, "--heading", heading, "--row", row]
  };
}

export function buildMdUpsertBulletQuickAction(targetPath: string, heading: string, bullet: string): PlannedQuickAction {
  return {
    title: `Upsert bullet under "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["md", "upsert-bullet", targetPath, "--heading", heading, "--bullet", bullet]
  };
}

export function buildMdReplaceSectionQuickAction(targetPath: string, heading: string, content: string): PlannedQuickAction {
  return {
    title: `Replace "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["md", "replace-section", targetPath, "--heading", heading, "--content", content]
  };
}

export function buildDocPrependQuickAction(targetPath: string, selector: string, value: string): PlannedQuickAction {
  return {
    title: `Prepend to ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["doc", "prepend", targetPath, selector, value]
  };
}

export function buildDocEnsureQuickAction(targetPath: string, selector: string, value: string): PlannedQuickAction {
  return {
    title: `Ensure ${selector} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["doc", "ensure", targetPath, selector, value]
  };
}

export function buildDocMoveQuickAction(targetPath: string, from: string, to: string): PlannedQuickAction {
  return {
    title: `Move ${from} to ${to} in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["doc", "move", targetPath, from, to]
  };
}

export function buildMdInsertAfterHeadingQuickAction(targetPath: string, heading: string, content: string): PlannedQuickAction {
  return {
    title: `Insert after "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["md", "insert-after-heading", targetPath, "--heading", heading, "--content", content]
  };
}

export function buildMdInsertAfterSectionQuickAction(targetPath: string, heading: string, content: string): PlannedQuickAction {
  return {
    title: `Insert after section "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["md", "insert-after-section", targetPath, "--heading", heading, "--content", content]
  };
}

export function buildMdInsertBeforeHeadingQuickAction(targetPath: string, heading: string, content: string): PlannedQuickAction {
  return {
    title: `Insert before "${heading}" in ${path.basename(targetPath)}`,
    targetPath,
    targetArgIndices: [2],
    args: ["md", "insert-before-heading", targetPath, "--heading", heading, "--content", content]
  };
}

export function buildPatchMergeQuickAction(patchPath: string, allowConflicts: boolean): PlannedQuickAction {
  const args: string[] = ["patch", "merge", patchPath, "--apply"];
  if (allowConflicts) {
    args.push("--allow-conflicts");
  }
  return {
    title: `Merge patch ${path.basename(patchPath)}`,
    targetPath: patchPath,
    targetArgIndices: [2],
    args
  };
}

export function buildUndoQuickAction(workspacePath: string): PlannedQuickAction {
  return {
    title: "Undo last patchloom change",
    targetPath: workspacePath,
    targetArgIndices: [],
    args: ["undo", "--apply"]
  };
}

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function isStructuredDocumentPath(filePath: string): boolean {
  return STRUCTURED_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function retargetQuickAction(action: PlannedQuickAction, nextTargetPath: string): PlannedQuickAction {
  return {
    ...action,
    targetPath: nextTargetPath,
    args: action.args.map((arg, index) => action.targetArgIndices.includes(index) ? nextTargetPath : arg)
  };
}

export function withApplyFlag(args: readonly string[]): string[] {
  return args.includes("--apply") ? [...args] : [...args, "--apply"];
}

/**
 * Prepend the global `--contain` flag so CLI ops cannot escape the cwd workspace.
 * Global flags must appear before the subcommand (`patchloom --contain replace ...`).
 */
export function withContainFlag(args: readonly string[]): string[] {
  return args[0] === "--contain" || args.includes("--contain")
    ? [...args]
    : ["--contain", ...args];
}

async function previewAndMaybeApply(
  binaryPath: string,
  target: WorkspaceFileTarget,
  action: PlannedQuickAction
): Promise<void> {
  const vscode = await import("vscode");
  const originalDocument = await vscode.workspace.openTextDocument(target.uri);
  const originalContent = await fs.readFile(target.absolutePath, "utf8");
  let preview: VSCode.TextDocument | undefined;
  try {
    preview = await buildPreviewDocument(binaryPath, action, originalContent, originalDocument.languageId);
  } catch (error) {
    getPatchloomLog()?.show();
    await vscode.window.showErrorMessage(
      `Patchloom failed while previewing changes to ${target.relativePath}: ${formatError(error)}`
    );
    return;
  }
  if (!preview) {
    await vscode.window.showInformationMessage(`No changes to preview for ${target.relativePath}.`);
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

  const result = await executePatchloom(binaryPath, withApplyFlag(action.args), target.workspaceFolder.uri.fsPath);
  if (result.exitCode !== 0) {
    await vscode.window.showErrorMessage(
      `Patchloom failed while applying changes to ${target.relativePath}: ${formatCliOutput(result)}`
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
  languageId: string
): Promise<VSCode.TextDocument | undefined> {
  const vscode = await import("vscode");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "patchloom-preview-"));
  const tempPath = path.join(tempDir, path.basename(action.targetPath));

  try {
    await fs.writeFile(tempPath, originalContent, "utf8");
    const previewAction = retargetQuickAction(action, tempPath);
    const result = await executePatchloom(binaryPath, withApplyFlag(previewAction.args), tempDir);
    if (result.exitCode !== 0 && result.exitCode !== 3) {
      throw new Error(formatCliOutput(result));
    }

    const previewContent = await fs.readFile(tempPath, "utf8");
    if (previewContent === originalContent) {
      return undefined;
    }

    return vscode.workspace.openTextDocument({
      language: languageId,
      content: previewContent
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
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

function pathEscapesWorkspace(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${path.sep}`);
}

export function resolveWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(absolutePath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  if (!relativePath || pathEscapesWorkspace(relativePath) || path.isAbsolute(relativePath)) {
    throw new Error(
      "File path must stay inside the current workspace folder. Use a path under this folder (for example src/app.ts), or open the folder that owns the file."
    );
  }
  return relativePath.split(path.sep).join("/");
}

export function isPathInsideWorkspace(workspaceRoot: string, absolutePath: string): boolean {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(absolutePath);
  const fold = process.platform === "win32" || process.platform === "darwin"
    ? (value: string) => value.toLowerCase()
    : (value: string) => value;
  const root = fold(resolvedRoot);
  const target = fold(resolvedPath);
  return target === root || target.startsWith(`${root}${path.sep}`);
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

  const openDocument = vscode.workspace.textDocuments.find((document) => sameFilePath(document.uri.fsPath, target.absolutePath));
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

export interface ExecutePatchloomOptions {
  /** When true (default), prefix args with global `--contain` for workspace path guarding. */
  readonly contain?: boolean;
}

async function executePatchloom(
  binaryPath: string,
  args: readonly string[],
  cwd: string,
  options: ExecutePatchloomOptions = {}
): Promise<PatchloomCommandResult> {
  const finalArgs = options.contain === false ? [...args] : withContainFlag(args);
  const log = getPatchloomLog();
  const runtime = await getPatchloomRuntimeConfig();
  const env = mergePatchloomEnv(process.env, runtime.extraEnv);
  logCliCommand(log, runtime.trace, binaryPath, finalArgs, cwd);

  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, finalArgs, {
      cwd,
      env,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    });
    const result: PatchloomCommandResult = { exitCode: 0, stdout, stderr };
    logCliResult(log, runtime.trace, result.exitCode, result.stdout, result.stderr);
    return result;
  } catch (error) {
    const execFailure = asExecFailure(error);
    const result: PatchloomCommandResult = {
      exitCode: execFailure ? execFailure.exitCode : 1,
      stdout: execFailure ? execFailure.stdout : "",
      stderr: execFailure
        ? execFailure.stderr || execFailure.message
        : formatError(error)
    };
    logCliResult(log, runtime.trace, result.exitCode, result.stdout, result.stderr);
    return result;
  }
}

function sameFilePath(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === "win32"
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

function asExecFailure(error: unknown): (Error & { stdout: string; stderr: string; exitCode: number }) | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const candidate = error as Error & { code?: number | string; stdout?: string; stderr?: string; exitCode?: number };
  if (typeof candidate.stdout !== "string" || typeof candidate.stderr !== "string") {
    return undefined;
  }

  const exitCode = typeof candidate.code === "number"
    ? candidate.code
    : typeof candidate.exitCode === "number"
      ? candidate.exitCode
      : undefined;
  if (exitCode === undefined) {
    return undefined;
  }

  return {
    ...candidate,
    stdout: candidate.stdout,
    stderr: candidate.stderr,
    exitCode
  };
}
