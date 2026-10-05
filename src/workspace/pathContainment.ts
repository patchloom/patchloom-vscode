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

export function resolveWorkspaceRelativePath(workspaceRoot: string, absolutePath: string): string {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolvedPath = path.resolve(absolutePath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);
  if (!relativePath || pathEscapesRoot(relativePath) || path.isAbsolute(relativePath)) {
    throw new Error(
      "File path must stay inside the current workspace folder. Use a path under this folder (for example src/app.ts), or open the folder that owns the file."
    );
  }
  return relativePath.split(path.sep).join("/");
}
