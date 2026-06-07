import assert from "node:assert/strict";
import test from "node:test";
import { buildBatchTemplate, parseBatchOperationCount } from "../../src/commands/batchApply.js";

test("buildBatchTemplate returns line-oriented format with three operations", () => {
  const template = buildBatchTemplate();
  const lines = template.split("\n").filter((line) => line.trim().length > 0);

  assert.equal(lines.length, 3);
  assert.ok(lines[0].startsWith("replace "), "first line should be a replace operation");
  assert.ok(lines[1].startsWith("doc.set "), "second line should be a doc.set operation");
  assert.ok(lines[2].startsWith("tidy.fix "), "third line should be a tidy.fix operation");
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
