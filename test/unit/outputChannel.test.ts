import assert from "node:assert/strict";
import test from "node:test";
import {
  createPatchloomLog,
  getPatchloomLog,
  logCliCommand,
  logCliResult,
  setPatchloomLog,
  writeUserVisibleOutput,
  type PatchloomLog
} from "../../src/logging/outputChannel.js";

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

  log.logCommand("/usr/bin/patchloom", ["replace", "old", "--new", "new", "file.txt"], "/workspace");

  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes("patchloom"));
  assert.ok(lines[0].includes("replace old --new new file.txt"));
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

  assert.equal(lines.length, 4, "should produce 2 stdout + 1 stderr + 1 exit code line");
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

test("logResult omits whitespace-only stdout and stderr", () => {
  const lines: string[] = [];
  const log = createPatchloomLog(() => ({
    appendLine(value: string) { lines.push(value); },
    show() {},
    dispose() {}
  }));

  log.logResult(0, "  \n  ", "  \n  ");

  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("Exit code: 0"));
});

test("logResult splits Windows-style CRLF line endings", () => {
  const lines: string[] = [];
  const log = createPatchloomLog(() => ({
    appendLine(value: string) { lines.push(value); },
    show() {},
    dispose() {}
  }));

  log.logResult(0, "line1\r\nline2\r\n", "");

  assert.equal(lines.length, 3, "should produce 2 stdout + 1 exit code line");
  assert.ok(lines.some(l => l === "line1"));
  assert.ok(lines.some(l => l === "line2"));
  assert.ok(lines.some(l => l.includes("Exit code: 0")));
});

test("logResult handles multiline stderr", () => {
  const lines: string[] = [];
  const log = createPatchloomLog(() => ({
    appendLine(value: string) { lines.push(value); },
    show() {},
    dispose() {}
  }));

  log.logResult(1, "", "error line 1\nerror line 2");

  assert.equal(lines.length, 3, "should produce 2 stderr + 1 exit code line");
  assert.ok(lines.some(l => l === "stderr: error line 1"));
  assert.ok(lines.some(l => l === "stderr: error line 2"));
  assert.ok(lines.some(l => l.includes("Exit code: 1")));
});

test("logCliResult skips when trace is off", () => {
  let called = false;
  const log = createPatchloomLog(() => ({
    appendLine() { called = true; },
    show() {},
    dispose() {}
  }));

  logCliResult(log, "off", 1, "stdout-body", "stderr-body");
  assert.equal(called, false);
});

test("logCliCommand skips when trace is off", () => {
  let called = false;
  const log = createPatchloomLog(() => ({
    appendLine() { called = true; },
    show() {},
    dispose() {}
  }));

  logCliCommand(log, "off", "/bin/patchloom", ["agent-rules"], "/tmp");
  assert.equal(called, false);
});

test("logCliCommand writes when trace is messages", () => {
  const lines: string[] = [];
  const log = createPatchloomLog(() => ({
    appendLine(value: string) { lines.push(value); },
    show() {},
    dispose() {}
  }));

  logCliCommand(log, "messages", "/bin/patchloom", ["agent-rules"], "/tmp");
  assert.ok(lines.some(l => l.includes("agent-rules")));
});

test("logCliResult omits streams when trace is messages", () => {
  const lines: string[] = [];
  const log = createPatchloomLog(() => ({
    appendLine(value: string) { lines.push(value); },
    show() {},
    dispose() {}
  }));

  logCliResult(log, "messages", 1, "stdout-body", "stderr-body");
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes("Exit code: 1"));
  assert.ok(!lines.some(l => l.includes("stdout-body") || l.includes("stderr-body")));
});

test("logCliResult dumps streams when trace is verbose", () => {
  const lines: string[] = [];
  const log = createPatchloomLog(() => ({
    appendLine(value: string) { lines.push(value); },
    show() {},
    dispose() {}
  }));

  logCliResult(log, "verbose", 0, "stdout-body", "stderr-body");
  assert.ok(lines.some(l => l === "stdout-body"));
  assert.ok(lines.some(l => l === "stderr: stderr-body"));
  assert.ok(lines.some(l => l.includes("Exit code: 0")));
});

function fakeLog(): { log: PatchloomLog; messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    log: {
      log(message: string) { messages.push(message); },
      logCommand() {},
      logResult() {},
      show() {},
      dispose() {}
    }
  };
}

test("writeUserVisibleOutput no-ops on empty string", () => {
  const { log, messages } = fakeLog();
  writeUserVisibleOutput(log, "");
  assert.deepEqual(messages, []);
});

test("writeUserVisibleOutput logs non-empty text", () => {
  const { log, messages } = fakeLog();
  writeUserVisibleOutput(log, "file.ts:1:TODO");
  assert.deepEqual(messages, ["file.ts:1:TODO"]);
});

test("writeUserVisibleOutput no-ops when log is undefined", () => {
  writeUserVisibleOutput(undefined, "hits");
});
