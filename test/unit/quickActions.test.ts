import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreateQuickAction,
  buildDocGetQuickAction,
  buildDocSetQuickAction,
  buildReplaceQuickAction,
  buildSearchQuickAction,
  buildTidyQuickAction,
  isStructuredDocumentPath,
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

test("buildDocGetQuickAction builds a doc get command", () => {
  const action = buildDocGetQuickAction("/workspace/demo/package.json", "scripts.test");

  assert.equal(action.title, "Get scripts.test from package.json");
  assert.deepEqual(action.args, ["doc", "get", "/workspace/demo/package.json", "scripts.test"]);
  assert.deepEqual(action.targetArgIndices, [2]);
});
