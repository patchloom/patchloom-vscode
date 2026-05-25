import assert from "node:assert/strict";
import test from "node:test";
import { buildBatchTemplate, parseBatchOperationCount } from "../../src/commands/batchApply.js";

test("buildBatchTemplate returns valid JSON with three operations", () => {
  const template = buildBatchTemplate();
  const parsed = JSON.parse(template);

  assert.ok(Array.isArray(parsed.operations));
  assert.equal(parsed.operations.length, 3);
  assert.equal(parsed.operations[0].op, "replace");
  assert.equal(parsed.operations[1].op, "tidy");
  assert.equal(parsed.operations[2].op, "doc-set");
});

test("buildBatchTemplate ends with a newline", () => {
  const template = buildBatchTemplate();
  assert.ok(template.endsWith("\n"));
});

test("parseBatchOperationCount counts operations in valid plan", () => {
  const plan = JSON.stringify({
    operations: [
      { op: "replace", file: "a.txt", from: "x", to: "y" },
      { op: "tidy", file: "b.txt", fixes: [] }
    ]
  });

  assert.equal(parseBatchOperationCount(plan), 2);
});

test("parseBatchOperationCount returns 0 for invalid JSON", () => {
  assert.equal(parseBatchOperationCount("not json"), 0);
});

test("parseBatchOperationCount returns 0 for missing operations", () => {
  assert.equal(parseBatchOperationCount('{"other": "data"}'), 0);
});

test("parseBatchOperationCount returns 0 for empty operations array", () => {
  assert.equal(parseBatchOperationCount('{"operations": []}'), 0);
});

test("parseBatchOperationCount returns 0 when operations is not an array", () => {
  assert.equal(parseBatchOperationCount('{"operations": "not-an-array"}'), 0);
  assert.equal(parseBatchOperationCount('{"operations": 42}'), 0);
  assert.equal(parseBatchOperationCount('{"operations": null}'), 0);
});

// --- #34: snapshot-style template tests ---

test("buildBatchTemplate replace operation has required fields", () => {
  const parsed = JSON.parse(buildBatchTemplate());
  const replace = parsed.operations[0];
  assert.equal(replace.op, "replace");
  assert.ok("file" in replace, "replace operation missing 'file'");
  assert.ok("from" in replace, "replace operation missing 'from'");
  assert.ok("to" in replace, "replace operation missing 'to'");
});

test("buildBatchTemplate tidy operation has required fields", () => {
  const parsed = JSON.parse(buildBatchTemplate());
  const tidy = parsed.operations[1];
  assert.equal(tidy.op, "tidy");
  assert.ok("file" in tidy, "tidy operation missing 'file'");
  assert.ok(Array.isArray(tidy.fixes), "tidy operation 'fixes' should be an array");
});

test("buildBatchTemplate doc-set operation has required fields", () => {
  const parsed = JSON.parse(buildBatchTemplate());
  const docSet = parsed.operations[2];
  assert.equal(docSet.op, "doc-set");
  assert.ok("file" in docSet, "doc-set operation missing 'file'");
  assert.ok("selector" in docSet, "doc-set operation missing 'selector'");
  assert.ok("value" in docSet, "doc-set operation missing 'value'");
});
