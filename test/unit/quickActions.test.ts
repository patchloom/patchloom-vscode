import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  buildCreateQuickAction,
  buildDocGetQuickAction,
  buildDocSetQuickAction,
  buildReplaceQuickAction,
  buildSearchQuickAction,
  buildTidyQuickAction,
  isStructuredDocumentPath,
  resolveWorkspaceRelativePath,
  retargetQuickAction,
  withApplyFlag
} from "../../src/commands/quickActions.js";

test("buildReplaceQuickAction builds a replace command for one file", () => {
  const action = buildReplaceQuickAction("/workspace/demo/README.md", "old", "new");

  assert.equal(action.title, "Replace text in README.md");
  assert.deepEqual(action.targetArgIndices, [4]);
  assert.deepEqual(action.args, ["replace", "old", "--to", "new", "/workspace/demo/README.md"]);
});

test("buildTidyQuickAction includes selected tidy flags", () => {
  const action = buildTidyQuickAction("/workspace/demo/file.txt", [
    "ensure-final-newline",
    "trim-trailing-whitespace",
    "normalize-eol-lf"
  ]);

  assert.equal(action.title, "Tidy file.txt");
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, [
    "tidy",
    "fix",
    "/workspace/demo/file.txt",
    "--ensure-final-newline",
    "--trim-trailing-whitespace",
    "--normalize-eol",
    "lf"
  ]);
});

test("buildDocSetQuickAction builds a doc set command", () => {
  const action = buildDocSetQuickAction("/workspace/demo/package.json", "scripts.test", "vitest");

  assert.equal(action.title, "Set scripts.test in package.json");
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, ["doc", "set", "/workspace/demo/package.json", "scripts.test", "vitest"]);
});

test("retargetQuickAction swaps only the target path arguments", () => {
  const action = buildReplaceQuickAction("/workspace/demo/README.md", "/workspace/demo/README.md", "new");
  const retargeted = retargetQuickAction(action, "/tmp/preview/README.md");

  assert.deepEqual(retargeted.args, [
    "replace",
    "/workspace/demo/README.md",
    "--to",
    "new",
    "/tmp/preview/README.md"
  ]);
});

test("withApplyFlag appends apply once", () => {
  assert.deepEqual(withApplyFlag(["replace", "old", "--to", "new", "README.md"]), [
    "replace",
    "old",
    "--to",
    "new",
    "README.md",
    "--apply"
  ]);
  assert.deepEqual(withApplyFlag(["replace", "old", "--to", "new", "README.md", "--apply"]), [
    "replace",
    "old",
    "--to",
    "new",
    "README.md",
    "--apply"
  ]);
});

test("isStructuredDocumentPath recognizes supported structured formats", () => {
  assert.equal(isStructuredDocumentPath("package.json"), true);
  assert.equal(isStructuredDocumentPath("config.yaml"), true);
  assert.equal(isStructuredDocumentPath("config.yml"), true);
  assert.equal(isStructuredDocumentPath("Cargo.toml"), true);
  assert.equal(isStructuredDocumentPath("README.md"), false);
});

test("isStructuredDocumentPath handles uppercase extensions", () => {
  assert.equal(isStructuredDocumentPath("data.JSON"), true);
  assert.equal(isStructuredDocumentPath("config.YAML"), true);
  assert.equal(isStructuredDocumentPath("config.YML"), true);
  assert.equal(isStructuredDocumentPath("settings.TOML"), true);
  assert.equal(isStructuredDocumentPath("README.MD"), false);
});

test("isStructuredDocumentPath rejects files without extensions", () => {
  assert.equal(isStructuredDocumentPath("Makefile"), false);
  assert.equal(isStructuredDocumentPath(""), false);
  assert.equal(isStructuredDocumentPath("file."), false);
});

test("isStructuredDocumentPath rejects dotfiles without basenames", () => {
  assert.equal(isStructuredDocumentPath(".json"), false);
  assert.equal(isStructuredDocumentPath(".yaml"), false);
  assert.equal(isStructuredDocumentPath(".env"), false);
});

test("buildTidyQuickAction with a single fix omits unselected flags", () => {
  const action = buildTidyQuickAction("/workspace/demo/file.txt", ["normalize-eol-lf"]);

  assert.deepEqual(action.args, [
    "tidy",
    "fix",
    "/workspace/demo/file.txt",
    "--normalize-eol",
    "lf"
  ]);
});

test("buildSearchQuickAction builds a search command without glob", () => {
  const action = buildSearchQuickAction("/workspace/demo", "TODO");

  assert.equal(action.title, 'Search for "TODO"');
  assert.deepEqual(action.args, ["search", "TODO", "/workspace/demo"]);
  assert.deepEqual(action.targetArgIndices, [2]);
});

test("buildSearchQuickAction includes glob when provided", () => {
  const action = buildSearchQuickAction("/workspace/demo", "TODO", "*.ts");

  assert.equal(action.title, 'Search for "TODO"');
  assert.deepEqual(action.args, ["search", "TODO", "--glob", "*.ts", "/workspace/demo"]);
  assert.deepEqual(action.targetArgIndices, [4]);
});

test("buildCreateQuickAction builds a create command", () => {
  const action = buildCreateQuickAction("/workspace/demo/src/newfile.ts");

  assert.equal(action.title, "Create newfile.ts");
  assert.deepEqual(action.args, ["create", "/workspace/demo/src/newfile.ts"]);
  assert.deepEqual(action.targetArgIndices, [1]);
});

test("buildSearchQuickAction preserves spaces in pattern as a single arg", () => {
  const action = buildSearchQuickAction("/workspace/demo", "hello world");

  assert.deepEqual(action.args, ["search", "hello world", "/workspace/demo"]);
});

test("buildDocGetQuickAction builds a doc get command", () => {
  const action = buildDocGetQuickAction("/workspace/demo/package.json", "scripts.test");

  assert.equal(action.title, "Get scripts.test from package.json");
  assert.deepEqual(action.args, ["doc", "get", "/workspace/demo/package.json", "scripts.test"]);
  assert.deepEqual(action.targetArgIndices, [2]);
});

// --- #33: resolveWorkspaceRelativePath path containment ---

test("resolveWorkspaceRelativePath accepts path inside workspace", () => {
  const rel = resolveWorkspaceRelativePath("/workspace/demo", "/workspace/demo/src/file.ts");
  assert.equal(rel, "src/file.ts");
});

test("resolveWorkspaceRelativePath accepts nested subdirectory", () => {
  const rel = resolveWorkspaceRelativePath("/workspace/demo", "/workspace/demo/a/b/c/d.txt");
  assert.equal(rel, "a/b/c/d.txt");
});

test("resolveWorkspaceRelativePath rejects traversal with ..", () => {
  assert.throws(
    () => resolveWorkspaceRelativePath("/workspace/demo", "/workspace/demo/../../etc/passwd"),
    { message: "File path must stay inside the current workspace folder." }
  );
});

test("resolveWorkspaceRelativePath rejects absolute path outside workspace", () => {
  assert.throws(
    () => resolveWorkspaceRelativePath("/workspace/demo", "/tmp/evil.txt"),
    { message: "File path must stay inside the current workspace folder." }
  );
});

test("resolveWorkspaceRelativePath rejects workspace root itself", () => {
  assert.throws(
    () => resolveWorkspaceRelativePath("/workspace/demo", "/workspace/demo"),
    { message: "File path must stay inside the current workspace folder." }
  );
});

// --- #32: edge-case builder tests ---

test("buildSearchQuickAction with empty pattern produces valid args", () => {
  const action = buildSearchQuickAction("/workspace/demo", "");
  assert.deepEqual(action.args, ["search", "", "/workspace/demo"]);
});

test("buildSearchQuickAction with regex special characters", () => {
  const action = buildSearchQuickAction("/workspace/demo", "foo.*bar\\(baz\\)");
  assert.deepEqual(action.args, ["search", "foo.*bar\\(baz\\)", "/workspace/demo"]);
});

test("buildCreateQuickAction with spaces in path", () => {
  const action = buildCreateQuickAction("/workspace/my project/src/new file.ts");
  assert.equal(action.title, "Create new file.ts");
  assert.deepEqual(action.args, ["create", "/workspace/my project/src/new file.ts"]);
});

test("buildDocGetQuickAction with deeply nested selector", () => {
  const action = buildDocGetQuickAction("/workspace/demo/config.yaml", "a.b.c.d.e");
  assert.equal(action.title, "Get a.b.c.d.e from config.yaml");
  assert.deepEqual(action.args, ["doc", "get", "/workspace/demo/config.yaml", "a.b.c.d.e"]);
});

test("buildCreateQuickAction with unicode filename", () => {
  const action = buildCreateQuickAction("/workspace/demo/docs/日本語.md");
  assert.equal(action.title, "Create 日本語.md");
  assert.deepEqual(action.args, ["create", "/workspace/demo/docs/日本語.md"]);
});

test("buildSearchQuickAction with unicode pattern", () => {
  const action = buildSearchQuickAction("/workspace/demo", "café");
  assert.deepEqual(action.args, ["search", "café", "/workspace/demo"]);
});
