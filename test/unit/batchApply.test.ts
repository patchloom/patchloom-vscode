import assert from "node:assert/strict";
import test from "node:test";
import {
  BATCH_APPLY_PROMPT,
  buildBatchApplyArgs,
  buildBatchTemplate,
  formatBatchApplyCompletion,
  isEmptyBatchPlan,
  parseBatchOperationCount
} from "../../src/commands/batchApply.js";

test("buildBatchTemplate returns line-oriented format with twelve operations", () => {
  const template = buildBatchTemplate();
  const lines = template.split("\n").filter((line) => line.trim().length > 0);

  assert.equal(lines.length, 12);
  assert.ok(lines[0].startsWith("replace "), "first line should be a replace operation");
  assert.ok(lines[1].startsWith("replace ") && lines[1].includes("--fuzzy"), "second line should be fuzzy replace");
  assert.ok(lines[2].startsWith("file.prepend "), "third line should be file.prepend");
  assert.equal(lines.some((line) => line.includes("--insert-after")), false);
  assert.ok(lines[3].startsWith("doc.set "), "fourth line should be a doc.set operation");
  assert.ok(lines[4].startsWith("doc.set ") && lines[4].includes("tsconfig.jsonc"), "fifth line should be JSONC doc.set");
  assert.ok(lines[5].startsWith("doc.update "), "sixth line should be multi-match doc.update");
  assert.ok(lines[6].startsWith("doc.delete_where "), "seventh line should be multi-match doc.delete_where");
  assert.ok(lines[7].startsWith("doc.merge "), "eighth line should be multi-doc doc.merge");
  assert.ok(lines[8].startsWith("file.append "), "ninth line should be a file.append operation");
  assert.ok(lines[9].startsWith("file.rename "), "tenth line should be a directory file.rename");
  assert.ok(lines[10].startsWith("md.insert_after_section "), "eleventh line should be md.insert_after_section");
  assert.ok(lines[11].startsWith("tidy.fix "), "twelfth line should be a tidy.fix operation");
});

test("buildBatchTemplate ends with a newline", () => {
  const template = buildBatchTemplate();
  assert.ok(template.endsWith("\n"));
});

test("parseBatchOperationCount counts non-empty lines", () => {
  const plan = [
    'replace a.txt "x" "y"',
    'doc.set b.json key "val"'
  ].join("\n");

  assert.equal(parseBatchOperationCount(plan), 2);
});

test("parseBatchOperationCount returns 0 for empty input", () => {
  assert.equal(parseBatchOperationCount(""), 0);
});

test("parseBatchOperationCount returns 0 for whitespace-only input", () => {
  assert.equal(parseBatchOperationCount("   \n  \n"), 0);
});

test("parseBatchOperationCount ignores blank lines between operations", () => {
  const plan = 'replace a.txt "x" "y"\n\ndoc.set b.json key "v"\n';
  assert.equal(parseBatchOperationCount(plan), 2);
});

test("parseBatchOperationCount ignores # comments the CLI skips", () => {
  const plan = [
    "# note",
    "  # indented",
    'replace a.txt "x" "y"',
    ""
  ].join("\n");
  assert.equal(parseBatchOperationCount(plan), 1);
  assert.equal(parseBatchOperationCount("\uFEFF# only a comment\n"), 0);
  assert.equal(parseBatchOperationCount("\uFEFFtidy.fix src/main.ts\n"), 1);
});

test("parseBatchOperationCount counts a single operation", () => {
  assert.equal(parseBatchOperationCount('tidy.fix src/main.ts'), 1);
});

test("isEmptyBatchPlan is true for empty and whitespace-only plans", () => {
  assert.equal(isEmptyBatchPlan(""), true);
  assert.equal(isEmptyBatchPlan("   \n  \n"), true);
  assert.equal(isEmptyBatchPlan("# comment only\n  # still a comment\n"), true);
});

test("isEmptyBatchPlan is false when at least one operation is present", () => {
  assert.equal(isEmptyBatchPlan('tidy.fix src/main.ts'), false);
  assert.equal(isEmptyBatchPlan('\nreplace a.txt "x" "y"\n'), false);
});

// --- #34: snapshot-style template tests ---

test("buildBatchTemplate replace line has file and quoted arguments", () => {
  const lines = buildBatchTemplate().split("\n");
  const replaceLine = lines.find((l) => l.startsWith("replace "));
  assert.ok(replaceLine, "template should contain a replace line");
  assert.match(replaceLine, /replace \S+ ".+" ".+"/, "replace should have file and two quoted args");
});

test("buildBatchTemplate doc.set line has file, selector, and quoted value", () => {
  const lines = buildBatchTemplate().split("\n");
  const docSetLine = lines.find((l) => l.startsWith("doc.set "));
  assert.ok(docSetLine, "template should contain a doc.set line");
  assert.match(docSetLine, /doc\.set \S+ \S+ ".+"/, "doc.set should have file, selector, and quoted value");
});

test("buildBatchTemplate tidy.fix line has a file path", () => {
  const lines = buildBatchTemplate().split("\n");
  const tidyLine = lines.find((l) => l.startsWith("tidy.fix "));
  assert.ok(tidyLine, "template should contain a tidy.fix line");
  assert.match(tidyLine, /tidy\.fix \S+/, "tidy.fix should have a file path");
});

test("buildBatchTemplate file.append line has file and quoted content", () => {
  const lines = buildBatchTemplate().split("\n");
  const appendLine = lines.find((l) => l.startsWith("file.append "));
  assert.ok(appendLine, "template should contain a file.append line");
  assert.match(appendLine, /file\.append \S+ ".+"/, "file.append should have file and quoted content");
});

test("buildBatchTemplate includes fuzzy replace and md.insert_after_section examples", () => {
  const lines = buildBatchTemplate().split("\n");
  const fuzzyLine = lines.find((l) => l.includes("--fuzzy"));
  const sectionLine = lines.find((l) => l.startsWith("md.insert_after_section "));
  assert.ok(fuzzyLine, "template should contain a fuzzy replace example");
  assert.match(fuzzyLine, /--min-fuzzy-score/, "fuzzy replace should include min-fuzzy-score");
  assert.ok(sectionLine, "template should contain md.insert_after_section");
  assert.match(
    sectionLine,
    /md\.insert_after_section \S+ ".+" ".+"/,
    "md.insert_after_section should use path + heading + content positionals"
  );
});

test("buildBatchTemplate doc.merge line uses path selector value (CLI 0.16 multi-doc)", () => {
  const lines = buildBatchTemplate().split("\n");
  const mergeLine = lines.find((l) => l.startsWith("doc.merge "));
  assert.ok(mergeLine, "template should contain a doc.merge line");
  assert.match(
    mergeLine,
    /doc\.merge \S+ \S+ ".+"/,
    "doc.merge should have path, selector, and quoted value (path selector value)"
  );
  assert.match(mergeLine, /\s0\s/, "example should merge into document 0");
});

test("buildBatchTemplate uses file.prepend instead of a batch --insert-after token", () => {
  const lines = buildBatchTemplate().split("\n");
  const prependLine = lines.find((line) => line.startsWith("file.prepend "));
  assert.equal(prependLine, "file.prepend src/example.ts \"header line\"");
  assert.equal(lines.some((line) => line.includes("--insert-after")), false);
});

test("buildBatchTemplate includes JSONC doc.set and directory file.rename (CLI 0.35+)", () => {
  const lines = buildBatchTemplate().split("\n");
  const jsoncLine = lines.find((l) => l.includes("tsconfig.jsonc"));
  const renameLine = lines.find((l) => l.startsWith("file.rename "));
  assert.ok(jsoncLine, "template should contain a JSONC doc.set example");
  assert.match(jsoncLine, /doc\.set tsconfig\.jsonc compilerOptions\.strict true/);
  assert.ok(renameLine, "template should contain a file.rename example");
  assert.match(renameLine, /file\.rename \S+ \S+/);
});

test("buildBatchTemplate includes doc.update multi-match example (CLI 0.27+ suggested_op sibling)", () => {
  const lines = buildBatchTemplate().split("\n");
  const updateLine = lines.find((l) => l.startsWith("doc.update "));
  assert.ok(updateLine, "template should contain a doc.update line");
  assert.match(
    updateLine,
    /doc\.update \S+ ".+" \S+/,
    "doc.update should have path, selector, and value"
  );
  assert.match(updateLine, /\[\*\]|\[.+=.+\]/, "selector should use wildcard or predicate form");
});

test("buildBatchTemplate includes doc.delete_where multi-match example (CLI 0.27+ suggested_op sibling)", () => {
  const lines = buildBatchTemplate().split("\n");
  const deleteWhereLine = lines.find((l) => l.startsWith("doc.delete_where "));
  assert.ok(deleteWhereLine, "template should contain a doc.delete_where line");
  assert.match(
    deleteWhereLine,
    /doc\.delete_where \S+ \S+ \S+/,
    "doc.delete_where should have path, selector, and predicate"
  );
});

test("buildBatchApplyArgs prefixes global --contain before batch --json --apply", () => {
  assert.deepEqual(buildBatchApplyArgs(), ["--contain", "batch", "--json", "--apply"]);
});

test("formatBatchApplyCompletion names a refused replace instead of claiming every line applied", () => {
  const stdout = JSON.stringify({
    ok: true,
    status: "success",
    applied: true,
    files_changed: 1,
    files_created: 0,
    files_deleted: 0,
    refused: [{ path: "b.txt", match_mode: "exact", reason: "no_matches" }]
  });
  const completion = formatBatchApplyCompletion(stdout, 2);
  assert.equal(completion.warning, true);
  assert.equal(
    completion.message,
    "Batch apply: 1 file(s) changed. 1 operation(s) were not applied: b.txt (no matches)."
  );
});

test("formatBatchApplyCompletion warns when doc.delete removes nothing", () => {
  const stdout = JSON.stringify({
    ok: true,
    status: "success",
    applied: true,
    files_changed: 1,
    files_created: 0,
    files_deleted: 0,
    mutations: [{ path: "d.json", op: "doc.delete", changed: false, removed: 0 }]
  });
  const completion = formatBatchApplyCompletion(stdout, 2);
  assert.equal(completion.warning, true);
  assert.equal(
    completion.message,
    "Batch apply: 1 file(s) changed. 1 operation(s) were not applied: d.json (doc.delete changed nothing)."
  );
});

test("formatBatchApplyCompletion does not warn when doc.delete removes a key", () => {
  const stdout = JSON.stringify({
    ok: true,
    files_changed: 1,
    files_created: 0,
    files_deleted: 0,
    mutations: [{ path: "d.json", op: "doc.delete", changed: true, removed: 1 }]
  });
  const completion = formatBatchApplyCompletion(stdout, 1);
  assert.equal(completion.warning, false);
  assert.equal(completion.message, "Batch apply completed: 1 file(s) changed.");
});

test("formatBatchApplyCompletion warns when a same-file replace reports match_count 0", () => {
  const stdout = JSON.stringify({
    ok: true,
    status: "success",
    applied: true,
    files_changed: 1,
    files_created: 0,
    files_deleted: 0,
    match_count: 0
  });
  const completion = formatBatchApplyCompletion(stdout, 2);
  assert.equal(completion.warning, true);
  assert.match(completion.message, /A replace in the plan matched nothing/);
  assert.match(completion.message, /1 file\(s\) changed/);
});

test("formatBatchApplyCompletion reports a rename when no file content changed", () => {
  const stdout = JSON.stringify({
    ok: true,
    applied: true,
    files_changed: 0,
    files_created: 0,
    files_deleted: 0,
    files_renamed: 1
  });
  const completion = formatBatchApplyCompletion(stdout, 1);
  assert.equal(completion.warning, false);
  assert.equal(completion.message, "Batch apply completed: 1 file(s) renamed.");
});

test("formatBatchApplyCompletion reports created files without a zero changed count", () => {
  const stdout = JSON.stringify({
    ok: true,
    files_changed: 0,
    files_created: 1,
    files_deleted: 0
  });
  const completion = formatBatchApplyCompletion(stdout, 1);
  assert.equal(completion.warning, false);
  assert.equal(completion.message, "Batch apply completed: 1 file(s) created.");
});

test("formatBatchApplyCompletion falls back to the plan count when stdout is not JSON", () => {
  const completion = formatBatchApplyCompletion("applied 2 operations\n", 2);
  assert.equal(completion.warning, false);
  assert.equal(completion.message, "Batch apply completed: 2 operation(s) applied.");
});

test("BATCH_APPLY_PROMPT names dotted doc.update and doc.delete_where shapes", () => {
  assert.match(BATCH_APPLY_PROMPT, /doc\.update PATH SELECTOR VALUE/);
  assert.match(BATCH_APPLY_PROMPT, /doc\.delete_where PATH SELECTOR PREDICATE/);
  assert.match(BATCH_APPLY_PROMPT, /first non-whitespace character is #/);
  assert.match(BATCH_APPLY_PROMPT, /does not undo other writes/);
  assert.match(BATCH_APPLY_PROMPT, /format_failed/);
  assert.match(BATCH_APPLY_PROMPT, /Undo restores it/);
  assert.equal(BATCH_APPLY_PROMPT.includes("execute all operations atomically"), false);
});
