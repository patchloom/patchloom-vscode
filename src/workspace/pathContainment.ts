import { realpathSync } from "node:fs";
import * as path from "node:path";

function pathEscapesRoot(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${path.sep}`);
}

function isResolvedPathInsideRoot(root: string, absolutePath: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(absolutePath);
  const fold = process.platform === "win32" || process.platform === "darwin"
    ? (value: string) => value.toLowerCase()
    : (value: string) => value;
  const foldedRoot = fold(resolvedRoot);
  const target = fold(resolvedPath);
  return target === foldedRoot || target.startsWith(`${foldedRoot}${path.sep}`);
}

export function isPathInsideWorkspace(workspaceRoot: string, absolutePath: string): boolean {
  return isResolvedPathInsideRoot(workspaceRoot, absolutePath);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

/** Real path of absolutePath, or of its nearest existing ancestor plus the missing suffix. */
function realPathAllowingMissingSuffix(absolutePath: string): string | undefined {
  const missing: string[] = [];
  let current = path.resolve(absolutePath);
  while (true) {
    try {
      const realAncestor = realpathSync(current);
      if (missing.length === 0) {
        return realAncestor;
      }
      return path.join(realAncestor, ...missing.slice().reverse());
    } catch (error) {
      if (!isEnoent(error)) {
        return undefined;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return undefined;
      }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * True when the real path stays inside the root.
 * A missing leaf uses the nearest existing ancestor's real path plus the
 * missing suffix. Existing files that realpath outside stay rejected.
 */
export function isRealPathInsideWorkspace(root: string, absolutePath: string): boolean {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return false;
  }
  const resolved = realPathAllowingMissingSuffix(absolutePath);
  if (resolved === undefined) {
    return false;
  }
  return isResolvedPathInsideRoot(realRoot, resolved);
}

const workspacePathError =
  "File path must stay inside the current workspace folder. Use a path under this folder (for example src/app.ts), or open the folder that owns the file.";

function relativeInsideRoot(root: string, absolutePath: string): string | undefined {
  const relativePath = path.relative(path.resolve(root), path.resolve(absolutePath));
  if (!relativePath || pathEscapesRoot(relativePath) || path.isAbsolute(relativePath)) {
    return undefined;
  }
  return relativePath.split(path.sep).join("/");
}

/**
 * True when both paths name the same file. realpath folds macOS /var and
 * /tmp onto /private so an open editor matches a workspace-relative path.
 * A path that does not exist yet is compared as a resolved string.
 */
export function sameRealFilePath(left: string, right: string): boolean {
  return normalizeRealFilePath(left) === normalizeRealFilePath(right);
}

function normalizeRealFilePath(value: string): string {
  const resolved = path.resolve(value);
  let normalized = resolved;
  try {
    normalized = realpathSync(resolved);
  } catch {
    normalized = resolved;
  }
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function resolveWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  const lexical = relativeInsideRoot(workspaceRoot, absolutePath);
  if (lexical) {
    return lexical;
  }
  // /var and /tmp are symlinks to /private on macOS. The folder URI and a
  // pasted path can name one file with two prefixes. Accept that only when
  // the real path is still inside the real workspace.
  if (isRealPathInsideWorkspace(workspaceRoot, absolutePath)) {
    const realFile = realPathAllowingMissingSuffix(absolutePath);
    if (realFile) {
      const viaReal = relativeInsideRoot(realpathSync(workspaceRoot), realFile);
      if (viaReal) {
        return viaReal;
      }
    }
  }
  throw new Error(workspacePathError);
}
