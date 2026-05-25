import assert from "node:assert/strict";
import test from "node:test";
import { createPatchloomLog, getPatchloomLog, setPatchloomLog } from "../../src/logging/outputChannel.js";

test("createPatchloomLog lazily creates channel on first log call", () => {
  let channelCreated = false;
  const lines: string[] = [];
  const log = createPatchloomLog(() => {
    channelCreated = true;
    return {
      appendLine(value: string) { lines.push(value); },
      show() {},
      dispose() {}
    };
  });

  assert.equal(channelCreated, false, "channel should not be created before first use");
  log.log("hello");
  assert.equal(channelCreated, true, "channel should be created after first log call");
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("hello"));
});

test("logCommand appends command with arguments and cwd", () => {
  const lines: string[] = [];
  const log = createPatchloomLog(() => ({
    appendLine(value: string) { lines.push(value); },
    show() {},
    dispose() {}
  }));

  log.logCommand("/usr/bin/patchloom", ["replace", "old", "--to", "new", "file.txt"], "/workspace");

  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("patchloom"));
  assert.ok(lines[0].includes("replace old --to new file.txt"));
  assert.ok(lines[1].includes("cwd: /workspace"));
});

test("logResult appends stdout, stderr, and exit code", () => {
  const lines: string[] = [];
  const log = createPatchloomLog(() => ({
    appendLine(value: string) { lines.push(value); },
    show() {},
    dispose() {}
  }));

  log.logResult(0, "output line 1\noutput line 2\n", "warning\n");

  assert.ok(lines.some(l => l === "output line 1"));
  assert.ok(lines.some(l => l === "output line 2"));
  assert.ok(lines.some(l => l.includes("stderr: warning")));
  assert.ok(lines.some(l => l.includes("Exit code: 0")));
});

test("logResult omits empty stdout and stderr", () => {
  const lines: string[] = [];
  const log = createPatchloomLog(() => ({
    appendLine(value: string) { lines.push(value); },
    show() {},
    dispose() {}
  }));

  log.logResult(0, "", "");

  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("Exit code: 0"));
});

test("show calls channel.show with preserveFocus", () => {
  let showCalled = false;
  let preserveFocusArg: boolean | undefined;
  const log = createPatchloomLog(() => ({
    appendLine() {},
    show(preserveFocus?: boolean) { showCalled = true; preserveFocusArg = preserveFocus; },
    dispose() {}
  }));

  log.show();
  assert.equal(showCalled, true);
  assert.equal(preserveFocusArg, true);
});

test("dispose disposes channel and subsequent log creates a new one", () => {
  let createCount = 0;
  let disposed = false;
  const log = createPatchloomLog(() => {
    createCount++;
    return {
      appendLine() {},
      show() {},
      dispose() { disposed = true; }
    };
  });

  log.log("first");
  assert.equal(createCount, 1);

  log.dispose();
  assert.equal(disposed, true);

  log.log("second");
  assert.equal(createCount, 2);
});

test("setPatchloomLog and getPatchloomLog round-trip module state", () => {
  const original = getPatchloomLog();
  try {
    assert.equal(getPatchloomLog(), undefined);

    const log = createPatchloomLog(() => ({
      appendLine() {},
      show() {},
      dispose() {}
    }));
    setPatchloomLog(log);
    assert.equal(getPatchloomLog(), log);

    setPatchloomLog(undefined);
    assert.equal(getPatchloomLog(), undefined);
  } finally {
    setPatchloomLog(original);
  }
});

test("logResult handles multiline stderr", () => {
  const lines: string[] = [];
  const log = createPatchloomLog(() => ({
    appendLine(value: string) { lines.push(value); },
    show() {},
    dispose() {}
  }));

  log.logResult(1, "", "error line 1\nerror line 2");

  assert.ok(lines.some(l => l === "stderr: error line 1"));
  assert.ok(lines.some(l => l === "stderr: error line 2"));
  assert.ok(lines.some(l => l.includes("Exit code: 1")));
});
