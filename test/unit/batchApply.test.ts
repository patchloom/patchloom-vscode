import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBatchApplyArgs,
  buildBatchTemplate,
  parseBatchOperationCount
} from "../../src/commands/batchApply.js";

test("buildBatchTemplate returns line-oriented format with seven operations", () => {
  const template = buildBatchTemplate();
  const lines = template.split("\n").filter((line) => line.trim().length > 0);

  assert.equal(lines.length, 7);
  assert.ok(lines[0].startsWith("replace "), "first line should be a replace operation");
  assert.ok(lines[1].startsWith("replace ") && lines[1].includes("--fuzzy"), "second line should be fuzzy replace");
  assert.ok(lines[2].startsWith("doc.set "), "third line should be a doc.set operation");
  assert.ok(lines[3].startsWith("doc.merge "), "fourth line should be multi-doc doc.merge");
  assert.ok(lines[4].startsWith("file.append "), "fifth line should be a file.append operation");
  assert.ok(lines[5].startsWith("md.insert_after_section "), "sixth line should be md.insert_after_section");
  assert.ok(lines[6].startsWith("tidy.fix "), "seventh line should be a tidy.fix operation");
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

test("buildBatchApplyArgs prefixes global --contain before batch --apply", () => {
  assert.deepEqual(buildBatchApplyArgs(), ["--contain", "batch", "--apply"]);
});
