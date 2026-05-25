import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type * as VSCode from "vscode";
import { patchloomNeedsUpgrade, resolvePatchloomStatus } from "../binary/patchloom.js";
import { getPatchloomLog } from "../logging/outputChannel.js";
import { formatCliOutput, formatError } from "../util.js";
import { activeWorkspaceFolder, describeWorkspaceEnvironment } from "../workspace/readiness.js";

const execFileAsync = promisify(execFile);
const STRUCTURED_FILE_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".toml"]);

export type TidyFix = "ensure-final-newline" | "trim-trailing-whitespace" | "normalize-eol-lf";

export interface PlannedQuickAction {
  readonly title: string;
  readonly targetPath: string;
  readonly targetArgIndices: readonly number[];
  readonly args: readonly string[];
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
  const status = await resolvePatchloomStatus();
  if (!status.ready || !status.binaryPath) {
    const choice = await vscode.window.showWarningMessage(status.message, "Open Settings");
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand("patchloom.openPatchloomSettings");
    }
    return;
  }

  if (patchloomNeedsUpgrade(status)) {
    const choice = await vscode.window.showWarningMessage(
      `${status.compatibilityMessage}\n\nUpgrade Patchloom before running quick actions.`,
      "Open Releases"
    );
    if (choice === "Open Releases") {
      await vscode.commands.executeCommand("patchloom.openPatchloomReleases");
    }
    return;
  }

  const binaryPath = status.binaryPath;
  const actions: Array<VSCode.QuickPickItem & { run: () => Promise<void> }> = [
    {
      label: "Replace text in file",
      description: "Literal text replacement with diff preview",
      detail: "Builds `patchloom replace <from> --to <to> <file>`",
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
          prompt: "Selector path",
          placeHolder: "scripts.test",
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

        if (result.exitCode === 3) {
          await vscode.window.showInformationMessage(`No matches found for "${pattern}".`);
        } else if (result.exitCode !== 0) {
          await vscode.window.showErrorMessage(`Patchloom search failed: ${formatPatchloomOutput(result)}`);
        } else {
          log?.show();
          await vscode.window.showInformationMessage("Search results displayed in the Patchloom output channel.");
        }
      }
    },
    {
      label: "Create a new file",
      description: "Scaffold a new file in the workspace",
      detail: "Builds `patchloom create <path>`",
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
        const relative = path.relative(folder.uri.fsPath, absolutePath);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
          await vscode.window.showWarningMessage("File path must stay inside the workspace folder.");
          return;
        }

        const action = buildCreateQuickAction(absolutePath);
        const result = await executePatchloom(binaryPath, action.args, folder.uri.fsPath);

        if (result.exitCode !== 0) {
          await vscode.window.showErrorMessage(`Patchloom create failed: ${formatPatchloomOutput(result)}`);
          return;
        }

        const uri = vscode.Uri.file(absolutePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: false });
        await vscode.window.showInformationMessage(`Created ${relativePath.trim()}.`);
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
          prompt: "Selector path",
          placeHolder: "scripts.test",
          validateInput: (value) => value.length > 0 ? undefined : "Selector is required."
        });
        if (selector === undefined) {
          return;
        }

        const action = buildDocGetQuickAction(target.absolutePath, selector);
        const result = await executePatchloom(binaryPath, action.args, target.workspaceFolder.uri.fsPath);

        if (result.exitCode !== 0) {
          await vscode.window.showErrorMessage(`Patchloom doc get failed: ${formatPatchloomOutput(result)}`);
          return;
        }

        const value = result.stdout.trim();
        await vscode.env.clipboard.writeText(value);
        await vscode.window.showInformationMessage(`${selector} = ${value} (copied to clipboard)`);
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
    args: ["replace", from, "--to", to, targetPath]
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

export function buildSearchQuickAction(workspacePath: string, pattern: string, glob?: string): PlannedQuickAction {
  const args: string[] = ["search", pattern];
  if (glob) {
    args.push("--glob", glob);
  }
  args.push(workspacePath);
  const targetIndex = args.length - 1;

  return {
    title: `Search for "${pattern}"`,
    targetPath: workspacePath,
    targetArgIndices: [targetIndex],
    args
  };
}

export function buildCreateQuickAction(filePath: string): PlannedQuickAction {
  return {
    title: `Create ${path.basename(filePath)}`,
    targetPath: filePath,
    targetArgIndices: [1],
    args: ["create", filePath]
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

async function previewAndMaybeApply(
  binaryPath: string,
  target: WorkspaceFileTarget,
  action: PlannedQuickAction
): Promise<void> {
  const vscode = await import("vscode");
  const originalDocument = await vscode.workspace.openTextDocument(target.uri);
  const originalContent = await fs.readFile(target.absolutePath, "utf8");
  const preview = await buildPreviewDocument(binaryPath, action, originalContent, originalDocument.languageId);
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
      `Patchloom failed while applying changes to ${target.relativePath}: ${formatPatchloomOutput(result)}`
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
      throw new Error(formatPatchloomOutput(result));
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

export function resolveWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(absolutePath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("File path must stay inside the current workspace folder.");
  }
  return relativePath.split(path.sep).join("/");
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
    await vscode.window.showWarningMessage(`File not found: ${target.relativePath}`);
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

async function executePatchloom(
  binaryPath: string,
  args: readonly string[],
  cwd: string
): Promise<PatchloomCommandResult> {
  const log = getPatchloomLog();
  log?.logCommand(binaryPath, args, cwd);

  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    });
    const result: PatchloomCommandResult = { exitCode: 0, stdout, stderr };
    log?.logResult(result.exitCode, result.stdout, result.stderr);
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
    log?.logResult(result.exitCode, result.stdout, result.stderr);
    return result;
  }
}

function formatPatchloomOutput(result: PatchloomCommandResult): string {
  return formatCliOutput(result);
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
