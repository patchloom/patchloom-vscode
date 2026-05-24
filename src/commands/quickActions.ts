import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import type * as VSCode from "vscode";
import { patchloomNeedsUpgrade, resolvePatchloomStatus } from "../binary/patchloom";
import { formatError } from "../util";
import { activeWorkspaceFolder, describeWorkspaceEnvironment } from "../workspace/readiness";

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
  const { refreshStatusBar } = await import("../status/statusBar");
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

function toWorkspaceFileTarget(folder: VSCode.WorkspaceFolder, absolutePath: string): WorkspaceFileTarget {
  const workspaceRoot = path.resolve(folder.uri.fsPath);
  const resolvedPath = path.resolve(absolutePath);
  const relativePath = path.relative(workspaceRoot, resolvedPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("File path must stay inside the current workspace folder.");
  }

  return {
    workspaceFolder: folder,
    absolutePath: resolvedPath,
    relativePath: relativePath.split(path.sep).join("/"),
    uri: folder.uri.with({ path: path.posix.join(folder.uri.path, relativePath.split(path.sep).join("/")) })
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
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, args, {
      cwd,
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    });
    return {
      exitCode: 0,
      stdout,
      stderr
    };
  } catch (error) {
    const execFailure = asExecFailure(error);
    return {
      exitCode: execFailure ? execFailure.exitCode : 1,
      stdout: execFailure ? execFailure.stdout : "",
      stderr: execFailure
        ? execFailure.stderr || execFailure.message
        : formatError(error)
    };
  }
}

function formatPatchloomOutput(result: PatchloomCommandResult): string {
  const output = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
  return output || `exit code ${result.exitCode}`;
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
