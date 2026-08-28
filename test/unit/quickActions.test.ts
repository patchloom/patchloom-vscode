import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAppendQuickAction,
  buildApplyFragmentQuickAction,
  buildCreateQuickAction,
  buildInsertAfterMatchQuickAction,
  buildInsertBeforeMatchQuickAction,
  buildPrependQuickAction,
  buildDocAppendQuickAction,
  buildDocDeleteQuickAction,
  buildDocEnsureQuickAction,
  buildDocGetQuickAction,
  buildDocMergeQuickAction,
  buildDocMoveQuickAction,
  buildDocPrependQuickAction,
  buildDocSetQuickAction,
  buildMdInsertAfterHeadingQuickAction,
  buildMdInsertAfterSectionQuickAction,
  buildMdInsertBeforeHeadingQuickAction,
  buildMdReplaceSectionQuickAction,
  buildMdTableAppendQuickAction,
  buildMdUpsertBulletQuickAction,
  buildPatchMergeQuickAction,
  buildReplaceQuickAction,
  buildSearchQuickAction,
  buildTidyQuickAction,
  buildUndoQuickAction,
  isMarkdownPath,
  isStructuredDocumentPath,
  isPathInsideWorkspace,
  formatUndoFailureMessage,
  presentPatchMergeOutcome,
  presentSearchOutcome,
  presentUndoSuccess,
  resolveWorkspaceRelativePath,
  retargetQuickAction,
  withApplyFlag,
  withContainFlag
} from "../../src/commands/quickActions.js";
import type { PatchloomLog } from "../../src/logging/outputChannel.js";

function fakeLog(): { log: PatchloomLog; messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    log: {
      log(message: string) { messages.push(message); },
      logCommand() {},
      logResult() {},
      show() { messages.push("SHOW"); },
      dispose() {}
    }
  };
}

test("buildReplaceQuickAction builds a replace command for one file", () => {
  const action = buildReplaceQuickAction("/workspace/demo/README.md", "old", "new");

  assert.equal(action.title, "Replace text in README.md");
  assert.deepEqual(action.targetArgIndices, [4]);
  assert.deepEqual(action.args, ["replace", "old", "--new", "new", "/workspace/demo/README.md"]);
});

test("buildInsertAfterMatchQuickAction builds replace --insert-after (CLI 0.16+)", () => {
  const action = buildInsertAfterMatchQuickAction("/workspace/demo/app.ts", "const x = 1;", "const y = 2;");

  assert.equal(action.title, "Insert after match in app.ts");
  assert.deepEqual(action.targetArgIndices, [4]);
  assert.deepEqual(action.args, [
    "replace", "const x = 1;", "--insert-after", "const y = 2;", "/workspace/demo/app.ts"
  ]);
});

test("buildInsertBeforeMatchQuickAction builds replace --insert-before (CLI 0.16+)", () => {
  const action = buildInsertBeforeMatchQuickAction("/workspace/demo/app.ts", "return true;", "// checked");

  assert.equal(action.title, "Insert before match in app.ts");
  assert.deepEqual(action.targetArgIndices, [4]);
  assert.deepEqual(action.args, [
    "replace", "return true;", "--insert-before", "// checked", "/workspace/demo/app.ts"
  ]);
});

test("buildApplyFragmentQuickAction builds apply-fragment --after (CLI 0.22+)", () => {
  const action = buildApplyFragmentQuickAction(
    "/workspace/demo/lib.rs",
    "after",
    "fn foo() {",
    "  let x = 1;"
  );

  assert.equal(action.title, "Apply fragment in lib.rs");
  assert.deepEqual(action.targetArgIndices, [1]);
  assert.deepEqual(action.args, [
    "apply-fragment",
    "/workspace/demo/lib.rs",
    "--after",
    "fn foo() {",
    "--fragment",
    "  let x = 1;"
  ]);
});

test("buildApplyFragmentQuickAction supports --before and --old placements", () => {
  const before = buildApplyFragmentQuickAction("/ws/a.ts", "before", "return true;", "// note");
  assert.deepEqual(before.args, [
    "apply-fragment", "/ws/a.ts", "--before", "return true;", "--fragment", "// note"
  ]);

  const replaceSpan = buildApplyFragmentQuickAction("/ws/a.ts", "old", "old_span", "new_span");
  assert.deepEqual(replaceSpan.args, [
    "apply-fragment", "/ws/a.ts", "--old", "old_span", "--fragment", "new_span"
  ]);
});

test("retargetQuickAction preserves apply-fragment path index", () => {
  const action = buildApplyFragmentQuickAction("/workspace/demo/a.ts", "after", "anchor", "frag");
  const retargeted = retargetQuickAction(action, "/workspace/demo/b.ts");

  assert.equal(retargeted.targetPath, "/workspace/demo/b.ts");
  assert.deepEqual(retargeted.args, [
    "apply-fragment", "/workspace/demo/b.ts", "--after", "anchor", "--fragment", "frag"
  ]);
});

test("retargetQuickAction preserves insert-after args", () => {
  const action = buildInsertAfterMatchQuickAction("/workspace/demo/a.ts", "foo", "bar");
  const retargeted = retargetQuickAction(action, "/workspace/demo/b.ts");

  assert.equal(retargeted.targetPath, "/workspace/demo/b.ts");
  assert.deepEqual(retargeted.args, [
    "replace", "foo", "--insert-after", "bar", "/workspace/demo/b.ts"
  ]);
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
    "--new",
    "new",
    "/tmp/preview/README.md"
  ]);
});

test("withApplyFlag appends apply once", () => {
  assert.deepEqual(withApplyFlag(["replace", "old", "--new", "new", "README.md"]), [
    "replace",
    "old",
    "--new",
    "new",
    "README.md",
    "--apply"
  ]);
  assert.deepEqual(withApplyFlag(["replace", "old", "--new", "new", "README.md", "--apply"]), [
    "replace",
    "old",
    "--new",
    "new",
    "README.md",
    "--apply"
  ]);
});

test("withContainFlag prefixes global --contain once", () => {
  assert.deepEqual(withContainFlag(["replace", "old", "--new", "new", "f.txt"]), [
    "--contain",
    "replace",
    "old",
    "--new",
    "new",
    "f.txt"
  ]);
  assert.deepEqual(withContainFlag(["--contain", "batch", "--apply"]), [
    "--contain",
    "batch",
    "--apply"
  ]);
  assert.deepEqual(withContainFlag(["doc", "set", "a.json", "port", "1", "--contain"]), [
    "doc",
    "set",
    "a.json",
    "port",
    "1",
    "--contain"
  ]);
});

test("buildPrependQuickAction builds a file prepend command", () => {
  const action = buildPrependQuickAction("/workspace/demo/src/main.ts", "// copyright\n");
  assert.equal(action.title, "Prepend to main.ts");
  assert.deepEqual(action.args, [
    "prepend",
    "/workspace/demo/src/main.ts",
    "--content",
    "// copyright\n"
  ]);
  assert.deepEqual(action.targetArgIndices, [1]);
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

test("buildSearchQuickAction includes --files-without-match (CLI 0.29+)", () => {
  const action = buildSearchQuickAction("/workspace/demo", "TODO", undefined, {
    filesWithoutMatch: true
  });

  assert.equal(action.title, 'Search files without "TODO"');
  assert.deepEqual(action.args, ["search", "TODO", "--files-without-match", "/workspace/demo"]);
  assert.deepEqual(action.targetArgIndices, [3]);
});

test("buildSearchQuickAction combines --files-without-match with glob", () => {
  const action = buildSearchQuickAction("/workspace/demo", "TODO", "*.ts", {
    filesWithoutMatch: true
  });

  assert.equal(action.title, 'Search files without "TODO"');
  assert.deepEqual(action.args, [
    "search", "TODO", "--files-without-match", "--glob", "*.ts", "/workspace/demo"
  ]);
  assert.deepEqual(action.targetArgIndices, [5]);
});

test("buildCreateQuickAction builds a create command with content and apply", () => {
  const action = buildCreateQuickAction("/workspace/demo/src/newfile.ts", "hello");

  assert.equal(action.title, "Create newfile.ts");
  assert.deepEqual(action.args, [
    "create",
    "/workspace/demo/src/newfile.ts",
    "--content",
    "hello",
    "--apply"
  ]);
  assert.deepEqual(action.targetArgIndices, [1]);
});

test("buildCreateQuickAction allows empty content", () => {
  const action = buildCreateQuickAction("/workspace/demo/empty.txt");
  assert.deepEqual(action.args, [
    "create",
    "/workspace/demo/empty.txt",
    "--content",
    "",
    "--apply"
  ]);
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

test("isPathInsideWorkspace is true only for paths under the workspace", () => {
  assert.equal(isPathInsideWorkspace("/workspace/demo", "/workspace/demo/changes.patch"), true);
  assert.equal(isPathInsideWorkspace("/workspace/demo", "/tmp/outside.patch"), false);
  assert.equal(isPathInsideWorkspace("/workspace/demo", "/workspace/demo/..changes.patch"), true);
  assert.equal(isPathInsideWorkspace("/workspace/demo", "/workspace/other/fix.patch"), false);
});

test("resolveWorkspaceRelativePath allows a filename that starts with ..", () => {
  const rel = resolveWorkspaceRelativePath("/workspace/demo", "/workspace/demo/..changes.patch");
  assert.equal(rel, "..changes.patch");
});

test("resolveWorkspaceRelativePath rejects traversal with ..", () => {
  assert.throws(
    () => resolveWorkspaceRelativePath("/workspace/demo", "/workspace/demo/../../etc/passwd"),
    { message: "File path must stay inside the current workspace folder. Use a path under this folder (for example src/app.ts), or open the folder that owns the file." }
  );
});

test("resolveWorkspaceRelativePath rejects absolute path outside workspace", () => {
  assert.throws(
    () => resolveWorkspaceRelativePath("/workspace/demo", "/tmp/evil.txt"),
    { message: "File path must stay inside the current workspace folder. Use a path under this folder (for example src/app.ts), or open the folder that owns the file." }
  );
});

test("resolveWorkspaceRelativePath rejects workspace root itself", () => {
  assert.throws(
    () => resolveWorkspaceRelativePath("/workspace/demo", "/workspace/demo"),
    { message: "File path must stay inside the current workspace folder. Use a path under this folder (for example src/app.ts), or open the folder that owns the file." }
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
  const action = buildCreateQuickAction("/workspace/my project/src/new file.ts", "x");
  assert.equal(action.title, "Create new file.ts");
  assert.deepEqual(action.args, [
    "create",
    "/workspace/my project/src/new file.ts",
    "--content",
    "x",
    "--apply"
  ]);
});

test("buildDocGetQuickAction with deeply nested selector", () => {
  const action = buildDocGetQuickAction("/workspace/demo/config.yaml", "a.b.c.d.e");
  assert.equal(action.title, "Get a.b.c.d.e from config.yaml");
  assert.deepEqual(action.args, ["doc", "get", "/workspace/demo/config.yaml", "a.b.c.d.e"]);
});

test("buildCreateQuickAction with unicode filename", () => {
  const action = buildCreateQuickAction("/workspace/demo/docs/日本語.md", "# title");
  assert.equal(action.title, "Create 日本語.md");
  assert.deepEqual(action.args, [
    "create",
    "/workspace/demo/docs/日本語.md",
    "--content",
    "# title",
    "--apply"
  ]);
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

test("buildDocMergeQuickAction includes --selector for multi-doc merge (CLI 0.16+)", () => {
  const action = buildDocMergeQuickAction(
    "/workspace/demo/multi.yaml",
    '{"debug": true}',
    "0"
  );

  assert.equal(action.title, "Merge into 0 in multi.yaml");
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, [
    "doc", "merge", "/workspace/demo/multi.yaml",
    "--selector", "0",
    "--value", '{"debug": true}'
  ]);
});

test("buildDocMergeQuickAction omits --selector when selector is blank", () => {
  const action = buildDocMergeQuickAction("/workspace/demo/config.toml", '{"x": 1}', "  ");

  assert.equal(action.title, "Merge into config.toml");
  assert.deepEqual(action.args, [
    "doc", "merge", "/workspace/demo/config.toml",
    "--value", '{"x": 1}'
  ]);
  assert.ok(!action.args.includes("--selector"));
});

test("retargetQuickAction preserves doc merge selector flags", () => {
  const action = buildDocMergeQuickAction("/workspace/demo/a.yaml", '{"k": true}', "[0]");
  const retargeted = retargetQuickAction(action, "/workspace/demo/b.yaml");

  assert.equal(retargeted.targetPath, "/workspace/demo/b.yaml");
  assert.deepEqual(retargeted.args, [
    "doc", "merge", "/workspace/demo/b.yaml",
    "--selector", "[0]",
    "--value", '{"k": true}'
  ]);
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

test("buildMdInsertAfterSectionQuickAction builds a md insert-after-section command", () => {
  const action = buildMdInsertAfterSectionQuickAction(
    "/workspace/demo/README.md",
    "## Config",
    "## FAQ\n\nCommon questions."
  );

  assert.equal(action.title, 'Insert after section "## Config" in README.md');
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, [
    "md", "insert-after-section", "/workspace/demo/README.md",
    "--heading", "## Config",
    "--content", "## FAQ\n\nCommon questions."
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

// --- patch merge Quick Action (v0.2.0+) ---

test("buildPatchMergeQuickAction builds a patch merge command", () => {
  const action = buildPatchMergeQuickAction("/workspace/demo/changes.patch", false);

  assert.equal(action.title, "Merge patch changes.patch");
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, ["patch", "merge", "/workspace/demo/changes.patch", "--apply"]);
});

test("buildPatchMergeQuickAction includes allow-conflicts flag when enabled", () => {
  const action = buildPatchMergeQuickAction("/workspace/demo/stale.diff", true);

  assert.equal(action.title, "Merge patch stale.diff");
  assert.deepEqual(action.targetArgIndices, [2]);
  assert.deepEqual(action.args, ["patch", "merge", "/workspace/demo/stale.diff", "--apply", "--allow-conflicts"]);
});

test("retargetQuickAction works with patch merge command", () => {
  const action = buildPatchMergeQuickAction("/workspace/demo/fix.patch", false);
  const retargeted = retargetQuickAction(action, "/tmp/preview/fix.patch");

  assert.equal(retargeted.args[2], "/tmp/preview/fix.patch");
  assert.equal(retargeted.args[0], "patch");
  assert.equal(retargeted.args[1], "merge");
});

// --- append Quick Action (reflecting patchloom 0.4.0+) ---

test("buildAppendQuickAction builds an append command", () => {
  const action = buildAppendQuickAction("/workspace/demo/log.txt", "new log entry");

  assert.equal(action.title, "Append to log.txt");
  assert.deepEqual(action.targetArgIndices, [1]);
  assert.deepEqual(action.args, ["append", "/workspace/demo/log.txt", "--content", "new log entry"]);
});

// --- result presenters (search / patch-merge / undo) ---

test("presentSearchOutcome exit 0 writes streams + show, returns hits", () => {
  const { log, messages } = fakeLog();
  const kind = presentSearchOutcome(log, {
    exitCode: 0,
    stdout: "file.ts:1:hit",
    stderr: "note"
  });
  assert.equal(kind, "hits");
  assert.deepEqual(messages, ["file.ts:1:hit", "note", "SHOW"]);
});

test("presentSearchOutcome exit 3 writes nothing, returns none", () => {
  const { log, messages } = fakeLog();
  const kind = presentSearchOutcome(log, {
    exitCode: 3,
    stdout: "should-not-write",
    stderr: "also-not"
  });
  assert.equal(kind, "none");
  assert.deepEqual(messages, []);
});

test("presentSearchOutcome exit 2 writes nothing, returns error", () => {
  const { log, messages } = fakeLog();
  const kind = presentSearchOutcome(log, {
    exitCode: 2,
    stdout: "out",
    stderr: "err"
  });
  assert.equal(kind, "error");
  assert.deepEqual(messages, []);
});

test("presentPatchMergeOutcome exit 8 writes streams + show, returns conflicts", () => {
  const { log, messages } = fakeLog();
  const kind = presentPatchMergeOutcome(log, {
    exitCode: 8,
    stdout: "<<<<<<< HEAD",
    stderr: "unresolved conflicts"
  });
  assert.equal(kind, "conflicts");
  assert.deepEqual(messages, ["<<<<<<< HEAD", "unresolved conflicts", "SHOW"]);
});

test("presentPatchMergeOutcome exit 0 writes streams + show, returns ok", () => {
  const { log, messages } = fakeLog();
  const kind = presentPatchMergeOutcome(log, {
    exitCode: 0,
    stdout: "merged 2 hunks",
    stderr: ""
  });
  assert.equal(kind, "ok");
  assert.deepEqual(messages, ["merged 2 hunks", "SHOW"]);
});

test("presentPatchMergeOutcome exit 1 writes streams + show, returns error", () => {
  const { log, messages } = fakeLog();
  const kind = presentPatchMergeOutcome(log, {
    exitCode: 1,
    stdout: "out",
    stderr: "failed"
  });
  assert.equal(kind, "error");
  assert.deepEqual(messages, ["out", "failed", "SHOW"]);
});

test("presentUndoSuccess writes streams + show", () => {
  const { log, messages } = fakeLog();
  presentUndoSuccess(log, {
    stdout: "restored a.ts",
    stderr: "info"
  });
  assert.deepEqual(messages, ["restored a.ts", "info", "SHOW"]);
});

test("formatUndoFailureMessage uses no-backup copy when stderr mentions no backup", () => {
  assert.equal(
    formatUndoFailureMessage({
      exitCode: 1,
      stdout: "",
      stderr: "error: no backup found for workspace"
    }),
    "No patchloom backup to undo."
  );
});

test("formatUndoFailureMessage prefixes other failures with Patchloom undo failed", () => {
  assert.equal(
    formatUndoFailureMessage({
      exitCode: 2,
      stdout: "",
      stderr: "permission denied"
    }),
    "Patchloom undo failed: permission denied"
  );
});
