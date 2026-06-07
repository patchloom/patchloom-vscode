import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreateQuickAction,
  buildDocAppendQuickAction,
  buildDocDeleteQuickAction,
  buildDocEnsureQuickAction,
  buildDocGetQuickAction,
  buildDocMergeQuickAction,
  buildDocMoveQuickAction,
  buildDocPrependQuickAction,
  buildDocSetQuickAction,
  buildMdInsertAfterHeadingQuickAction,
  buildMdInsertBeforeHeadingQuickAction,
  buildMdReplaceSectionQuickAction,
  buildMdTableAppendQuickAction,
  buildMdUpsertBulletQuickAction,
  buildReplaceQuickAction,
  buildSearchQuickAction,
  buildTidyQuickAction,
  buildUndoQuickAction,
  isMarkdownPath,
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

// --- #115: doc mutation Quick Actions ---

test("buildDocDeleteQuickAction builds a doc delete command", () => {
  const action = buildDocDeleteQuickAction("/workspace/demo/config.yaml", "deprecated.key");

  assert.equal(action.title, "Delete deprecated.key from config.yaml");
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, ["doc", "delete", "/workspace/demo/config.yaml", "deprecated.key"]);
});

test("buildDocMergeQuickAction builds a doc merge command", () => {
  const action = buildDocMergeQuickAction("/workspace/demo/package.json", '{"debug": true}');

  assert.equal(action.title, "Merge into package.json");
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, ["doc", "merge", "/workspace/demo/package.json", "--value", '{"debug": true}']);
});

test("buildDocAppendQuickAction builds a doc append command", () => {
  const action = buildDocAppendQuickAction("/workspace/demo/config.yaml", "tags", '"v2"');

  assert.equal(action.title, "Append to tags in config.yaml");
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, ["doc", "append", "/workspace/demo/config.yaml", "tags", '"v2"']);
});

// --- #114: markdown Quick Actions ---

test("buildMdTableAppendQuickAction builds a md table-append command", () => {
  const action = buildMdTableAppendQuickAction("/workspace/demo/README.md", "## API", "| /users | List users |");

  assert.equal(action.title, 'Append table row under "## API" in README.md');
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, [
    "md", "table-append", "/workspace/demo/README.md",
    "--heading", "## API",
    "--row", "| /users | List users |"
  ]);
});

test("buildMdUpsertBulletQuickAction builds a md upsert-bullet command", () => {
  const action = buildMdUpsertBulletQuickAction("/workspace/demo/AGENTS.md", "## Rules", "Run make check");

  assert.equal(action.title, 'Upsert bullet under "## Rules" in AGENTS.md');
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, [
    "md", "upsert-bullet", "/workspace/demo/AGENTS.md",
    "--heading", "## Rules",
    "--bullet", "Run make check"
  ]);
});

test("buildMdReplaceSectionQuickAction builds a md replace-section command", () => {
  const action = buildMdReplaceSectionQuickAction("/workspace/demo/CHANGELOG.md", "## Unreleased", "- New feature");

  assert.equal(action.title, 'Replace "## Unreleased" in CHANGELOG.md');
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, [
    "md", "replace-section", "/workspace/demo/CHANGELOG.md",
    "--heading", "## Unreleased",
    "--content", "- New feature"
  ]);
});

// --- #116: undo Quick Action ---

test("buildUndoQuickAction builds an undo command", () => {
  const action = buildUndoQuickAction("/workspace/demo");

  assert.equal(action.title, "Undo last patchloom change");
  assert.equal(action.targetPath, "/workspace/demo");
  assert.deepEqual(action.targetArgIndices, []);
  assert.deepEqual(action.args, ["undo", "--apply"]);
});

// --- #120: remaining Quick Actions ---

test("buildDocPrependQuickAction builds a doc prepend command", () => {
  const action = buildDocPrependQuickAction("/workspace/demo/config.yaml", "tags", '"priority"');

  assert.equal(action.title, "Prepend to tags in config.yaml");
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, ["doc", "prepend", "/workspace/demo/config.yaml", "tags", '"priority"']);
});

test("buildDocEnsureQuickAction builds a doc ensure command", () => {
  const action = buildDocEnsureQuickAction("/workspace/demo/package.json", "scripts.test", "vitest");

  assert.equal(action.title, "Ensure scripts.test in package.json");
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, ["doc", "ensure", "/workspace/demo/package.json", "scripts.test", "vitest"]);
});

test("buildDocMoveQuickAction builds a doc move command", () => {
  const action = buildDocMoveQuickAction("/workspace/demo/config.yaml", "old.key", "new.key");

  assert.equal(action.title, "Move old.key to new.key in config.yaml");
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, ["doc", "move", "/workspace/demo/config.yaml", "old.key", "new.key"]);
});

test("buildMdInsertAfterHeadingQuickAction builds a md insert-after-heading command", () => {
  const action = buildMdInsertAfterHeadingQuickAction("/workspace/demo/README.md", "## Installation", "Run npm install");

  assert.equal(action.title, 'Insert after "## Installation" in README.md');
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, [
    "md", "insert-after-heading", "/workspace/demo/README.md",
    "--heading", "## Installation",
    "--content", "Run npm install"
  ]);
});

test("buildMdInsertBeforeHeadingQuickAction builds a md insert-before-heading command", () => {
  const action = buildMdInsertBeforeHeadingQuickAction("/workspace/demo/CHANGELOG.md", "## v1.0.0", "## v1.1.0\n\n- New feature");

  assert.equal(action.title, 'Insert before "## v1.0.0" in CHANGELOG.md');
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, [
    "md", "insert-before-heading", "/workspace/demo/CHANGELOG.md",
    "--heading", "## v1.0.0",
    "--content", "## v1.1.0\n\n- New feature"
  ]);
});

test("retargetQuickAction works with doc move command", () => {
  const action = buildDocMoveQuickAction("/workspace/demo/config.yaml", "old", "new");
  const retargeted = retargetQuickAction(action, "/tmp/preview/config.yaml");

  assert.equal(retargeted.args[2], "/tmp/preview/config.yaml");
  assert.equal(retargeted.args[0], "doc");
  assert.equal(retargeted.args[1], "move");
});

test("retargetQuickAction works with md insert-after-heading command", () => {
  const action = buildMdInsertAfterHeadingQuickAction("/workspace/demo/README.md", "## Usage", "text");
  const retargeted = retargetQuickAction(action, "/tmp/preview/README.md");

  assert.equal(retargeted.args[2], "/tmp/preview/README.md");
  assert.equal(retargeted.args[0], "md");
  assert.equal(retargeted.args[1], "insert-after-heading");
});

// --- isMarkdownPath ---

test("isMarkdownPath recognizes markdown extensions", () => {
  assert.equal(isMarkdownPath("README.md"), true);
  assert.equal(isMarkdownPath("docs/guide.markdown"), true);
  assert.equal(isMarkdownPath("blog/post.mdx"), true);
  assert.equal(isMarkdownPath("config.yaml"), false);
  assert.equal(isMarkdownPath("src/main.ts"), false);
});

test("isMarkdownPath handles uppercase extensions", () => {
  assert.equal(isMarkdownPath("README.MD"), true);
  assert.equal(isMarkdownPath("GUIDE.MARKDOWN"), true);
});

test("retargetQuickAction works with md commands", () => {
  const action = buildMdTableAppendQuickAction("/workspace/demo/README.md", "## API", "| col |");
  const retargeted = retargetQuickAction(action, "/tmp/preview/README.md");

  assert.equal(retargeted.args[2], "/tmp/preview/README.md");
  assert.equal(retargeted.args[0], "md");
  assert.equal(retargeted.args[1], "table-append");
});
