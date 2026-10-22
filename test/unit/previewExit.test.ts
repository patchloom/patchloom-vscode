import assert from "node:assert/strict";
import test from "node:test";
import { dryRunFollowUp, previewDryRunMayContinue, previewSnapshotStillCurrent } from "../../src/commands/previewExit.js";

const batchWouldWrite = `{
  "ok": true,
  "status": "changes_detected",
  "applied": false,
  "files_changed": 1,
  "refused": [{ "path": "other.txt", "reason": "no_matches" }]
}`;

const patchWouldWrite = `{
  "ok": true,
  "files": [{ "path": "note.txt", "status": "would_change" }],
  "applied": false
}`;

const mergeWouldWrite = `{
  "ok": true,
  "files": [{ "path": "note.txt", "status": "clean" }],
  "applied": false
}`;

test("preview dry run continues on exit 0 and on exit 2 that would write", () => {
  assert.equal(previewDryRunMayContinue({ exitCode: 0, stdout: '{"ok":true,"applied":false,"files":[]}' }), true);
  assert.equal(previewDryRunMayContinue({ exitCode: 2, stdout: batchWouldWrite }), true);
  assert.equal(previewDryRunMayContinue({ exitCode: 2, stdout: `\n${patchWouldWrite}\n` }), true);
  assert.equal(previewDryRunMayContinue({ exitCode: 2, stdout: mergeWouldWrite }), true);
});

test("preview dry run stops on failures and on exit 2 that is not a pending write", () => {
  assert.equal(previewDryRunMayContinue({
    exitCode: 3,
    stdout: '{"ok":false,"status":"no_matches","applied":false}'
  }), false);
  assert.equal(previewDryRunMayContinue({
    exitCode: 4,
    stdout: '{"ok":false,"error_kind":"parse_error","applied":false}'
  }), false);
  assert.equal(previewDryRunMayContinue({
    exitCode: 8,
    stdout: '{"ok":false,"error_kind":"conflicts","applied":false}'
  }), false);
  assert.equal(previewDryRunMayContinue({
    exitCode: 2,
    stdout: '{"ok":false,"applied":false}'
  }), false);
  assert.equal(previewDryRunMayContinue({
    exitCode: 2,
    stdout: '{"ok":true,"applied":true}'
  }), false);
  assert.equal(previewDryRunMayContinue({
    exitCode: 2,
    stdout: '{"ok":"true","applied":false}'
  }), false);
  assert.equal(previewDryRunMayContinue({ exitCode: 2, stdout: "would change note.txt" }), false);
  assert.equal(previewDryRunMayContinue({ exitCode: 2, stdout: "{not json" }), false);
  assert.equal(previewDryRunMayContinue({ exitCode: 1, stdout: batchWouldWrite }), false);
});

test("preview apply stops when the buffer or disk no longer matches the snapshot", () => {
  assert.equal(previewSnapshotStillCurrent("hello\n", "hello\r\n", "hello\n"), true);
  assert.equal(previewSnapshotStillCurrent("hello\n", "hello!\n", "hello\n"), false);
  assert.equal(previewSnapshotStillCurrent("hello\n", "hello\n", "hello!\n"), false);
});

test("dry run follow-up offers apply only when the preview would write or change nothing", () => {
  const wouldWrite = { exitCode: 2, stdout: patchWouldWrite };
  const conflict = { exitCode: 8, stdout: '{"ok":false,"error_kind":"conflicts","applied":false}' };
  assert.equal(dryRunFollowUp("apply", wouldWrite), "apply");
  assert.equal(dryRunFollowUp("merge", wouldWrite), "apply");
  assert.equal(dryRunFollowUp("merge", { exitCode: 0, stdout: '{"ok":true,"applied":false}' }), "apply");
  assert.equal(dryRunFollowUp("merge", conflict), "conflicts");
  assert.equal(dryRunFollowUp("apply", conflict), "stop");
  assert.equal(dryRunFollowUp("merge", { exitCode: 4, stdout: '{"ok":false,"applied":false}' }), "stop");
  assert.equal(dryRunFollowUp("apply", { exitCode: 5, stdout: '{"ok":false,"applied":false}' }), "stop");
});
