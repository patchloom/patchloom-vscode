import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBatchApplyArgs,
  buildBatchTemplate,
  isEmptyBatchPlan,
  parseBatchOperationCount
} from "../../src/commands/batchApply.js";

test("buildBatchTemplate returns line-oriented format with ten operations", () => {
  const template = buildBatchTemplate();
  const lines = template.split("\n").filter((line) => line.trim().length > 0);

  assert.equal(lines.length, 10);
  assert.ok(lines[0].startsWith("replace "), "first line should be a replace operation");
  assert.ok(lines[1].startsWith("replace ") && lines[1].includes("--fuzzy"), "second line should be fuzzy replace");
  assert.ok(lines[2].startsWith("replace ") && lines[2].includes("--insert-after"), "third line should be insert-after");
  assert.ok(lines[3].startsWith("doc.set "), "fourth line should be a doc.set operation");
  assert.ok(lines[4].startsWith("doc.update "), "fifth line should be multi-match doc.update");
  assert.ok(lines[5].startsWith("doc.delete_where "), "sixth line should be multi-match doc.delete_where");
  assert.ok(lines[6].startsWith("doc.merge "), "seventh line should be multi-doc doc.merge");
  assert.ok(lines[7].startsWith("file.append "), "eighth line should be a file.append operation");
  assert.ok(lines[8].startsWith("md.insert_after_section "), "ninth line should be md.insert_after_section");
  assert.ok(lines[9].startsWith("tidy.fix "), "tenth line should be a tidy.fix operation");
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

test("parseBatchOperationCount counts a single operation", () => {
  assert.equal(parseBatchOperationCount('tidy.fix src/main.ts'), 1);
});

test("isEmptyBatchPlan is true for empty and whitespace-only plans", () => {
  assert.equal(isEmptyBatchPlan(""), true);
  assert.equal(isEmptyBatchPlan("   \n  \n"), true);
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

test("buildBatchTemplate includes replace --insert-after example (CLI 0.16)", () => {
  const lines = buildBatchTemplate().split("\n");
  const insertLine = lines.find((l) => l.includes("--insert-after"));
  assert.ok(insertLine, "template should contain an insert-after example");
  assert.match(
    insertLine,
    /replace \S+ ".+" --insert-after=/,
    "insert-after should use batch flag form path pattern --insert-after=payload"
  );
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

test("buildBatchApplyArgs prefixes global --contain before batch --apply", () => {
  assert.deepEqual(buildBatchApplyArgs(), ["--contain", "batch", "--apply"]);
});
