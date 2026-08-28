import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import { MINIMUM_SUPPORTED_PATCHLOOM_VERSION } from "../../src/binary/patchloom.js";
import {
  buildAgentRulesArgs,
  classifyAgentsFile,
  generateAgentRules,
  isMissingFileError
} from "../../src/commands/initializeProject.js";
import { buildStatusDetails, preferredStatusAction } from "../../src/commands/showStatus.js";
import { buildPatchloomMcpEntry, configureMcpTargets, inspectMcpTargets } from "../../src/mcp/config.js";
import { setPatchloomLog } from "../../src/logging/outputChannel.js";
import {
  formatCliOutput,
  formatError,
  isAllowedPatchloomEnvKey,
  mergePatchloomEnv,
  resolvePatchloomEnvFromInspect,
  shouldLogCliCommands,
  shouldLogCliStreams
} from "../../src/util.js";

test("formatError extracts message from Error instances", () => {
  assert.equal(formatError(new Error("disk full")), "disk full");
});

test("formatError converts non-Error values to strings", () => {
  assert.equal(formatError("raw string"), "raw string");
  assert.equal(formatError(42), "42");
  assert.equal(formatError(null), "null");
  assert.equal(formatError(undefined), "undefined");
});

test("formatError falls back to String for Error with empty message", () => {
  const err = new Error("");
  assert.equal(formatError(err), String(err));
});

test("mergePatchloomEnv is identity when extra is undefined", () => {
  const base = { PATH: "/usr/bin", HOME: "/home/user" };
  assert.equal(mergePatchloomEnv(base, undefined), base);
});

test("mergePatchloomEnv is identity when extra is empty", () => {
  const base = { PATH: "/usr/bin", HOME: "/home/user" };
  assert.equal(mergePatchloomEnv(base, {}), base);
});

test("mergePatchloomEnv adds new keys from extra", () => {
  const merged = mergePatchloomEnv(
    { PATH: "/usr/bin" },
    { PATCHLOOM_LOG: "debug" }
  );
  assert.equal(merged.PATH, "/usr/bin");
  assert.equal(merged.PATCHLOOM_LOG, "debug");
});

test("mergePatchloomEnv overwrites matching keys from extra", () => {
  const merged = mergePatchloomEnv(
    { PATH: "/usr/bin", PATCHLOOM_LOG: "info" },
    { PATCHLOOM_LOG: "debug" }
  );
  assert.equal(merged.PATH, "/usr/bin");
  assert.equal(merged.PATCHLOOM_LOG, "debug");
});

test("mergePatchloomEnv ignores loader keys such as PATH and LD_PRELOAD", () => {
  const merged = mergePatchloomEnv(
    { PATH: "/usr/bin" },
    { PATH: "/tmp/evil/bin", LD_PRELOAD: "/tmp/evil.so", PATCHLOOM_LOG: "debug" }
  );
  assert.equal(merged.PATH, "/usr/bin");
  assert.equal(merged.LD_PRELOAD, undefined);
  assert.equal(merged.PATCHLOOM_LOG, "debug");
});

test("isAllowedPatchloomEnvKey accepts only PATCHLOOM_ prefix", () => {
  assert.equal(isAllowedPatchloomEnvKey("PATCHLOOM_LOG"), true);
  assert.equal(isAllowedPatchloomEnvKey("PATH"), false);
  assert.equal(isAllowedPatchloomEnvKey("DYLD_INSERT_LIBRARIES"), false);
});

test("resolvePatchloomEnvFromInspect uses merged env when trusted", () => {
  const merged = { PATCHLOOM_LOG: "workspace" };
  const inspect = { globalValue: { PATCHLOOM_LOG: "user" }, workspaceValue: merged };
  assert.deepEqual(resolvePatchloomEnvFromInspect(true, inspect, merged), merged);
});

test("resolvePatchloomEnvFromInspect ignores workspace env when untrusted", () => {
  const inspect = {
    globalValue: { PATCHLOOM_LOG: "user" },
    workspaceValue: { PATH: "/tmp/evil" }
  };
  assert.deepEqual(
    resolvePatchloomEnvFromInspect(false, inspect, inspect.workspaceValue),
    { PATCHLOOM_LOG: "user" }
  );
});

test("shouldLogCliCommands is true for messages and verbose", () => {
  assert.equal(shouldLogCliCommands("off"), false);
  assert.equal(shouldLogCliCommands("messages"), true);
  assert.equal(shouldLogCliCommands("verbose"), true);
});

test("shouldLogCliStreams is true only for verbose", () => {
  assert.equal(shouldLogCliStreams("off"), false);
  assert.equal(shouldLogCliStreams("messages"), false);
  assert.equal(shouldLogCliStreams("verbose"), true);
});

// --- #36: direct unit tests for formatCliOutput ---

test("formatCliOutput merges stderr and stdout into a single line", () => {
  const result = formatCliOutput({ exitCode: 0, stdout: "hello world", stderr: "warn: something" });
  assert.equal(result, "warn: something hello world");
});

test("formatCliOutput returns exit code when both streams are empty", () => {
  assert.equal(formatCliOutput({ exitCode: 1, stdout: "", stderr: "" }), "exit code 1");
  assert.equal(formatCliOutput({ exitCode: 0, stdout: "  \n  ", stderr: "  " }), "exit code 0");
});

test("formatCliOutput normalizes CRLF line endings", () => {
  const result = formatCliOutput({ exitCode: 0, stdout: "line1\r\nline2\r\n", stderr: "" });
  assert.equal(result, "line1 line2");
});

test("formatCliOutput prefers CLI JSON error envelope (guard_rejected, CLI 0.18+)", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "guard_rejected: path rejected by workspace guard: path escapes workspace directory: ../x",
    error_kind: "guard_rejected",
    applied: false
  });
  const result = formatCliOutput({ exitCode: 1, stdout, stderr: "" });
  assert.equal(
    result,
    "guard_rejected: path rejected by workspace guard: path escapes workspace directory: ../x"
  );
});

test("formatCliOutput prefixes error_kind when error body omits it", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "path escapes workspace directory: ../x",
    error_kind: "guard_rejected",
    applied: false
  });
  assert.equal(
    formatCliOutput({ exitCode: 1, stdout, stderr: "" }),
    "guard_rejected: path escapes workspace directory: ../x"
  );
});

test("formatCliOutput prefers JSON error over noisy stderr", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "line 1: batch replace does not accept CLI flag '--new'",
    error_kind: "parse_error",
    applied: false
  });
  assert.equal(
    formatCliOutput({ exitCode: 1, stdout, stderr: "some diagnostic noise\n" }),
    "parse_error: line 1: batch replace does not accept CLI flag '--new'"
  );
});

test("formatCliOutput surfaces already_exists kind (CLI 0.19+)", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "destination already exists: src/out.ts",
    error_kind: "already_exists",
    applied: false
  });
  assert.equal(
    formatCliOutput({ exitCode: 1, stdout, stderr: "" }),
    "already_exists: destination already exists: src/out.ts"
  );
});

test("formatCliOutput surfaces binary kind (CLI 0.20+)", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "target is a binary file: assets/logo.png",
    error_kind: "binary",
    applied: false
  });
  assert.equal(
    formatCliOutput({ exitCode: 1, stdout, stderr: "" }),
    "binary: target is a binary file: assets/logo.png"
  );
});

test("formatCliOutput surfaces invalid_encoding kind (CLI 0.20+)", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "target is not valid UTF-8 text: notes.txt",
    error_kind: "invalid_encoding",
    applied: false
  });
  assert.equal(
    formatCliOutput({ exitCode: 1, stdout, stderr: "" }),
    "invalid_encoding: target is not valid UTF-8 text: notes.txt"
  );
});

test("formatCliOutput surfaces fuzzy_span_suspicious kind (CLI 0.22+)", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "fuzzy match span is suspiciously wide for the old string",
    error_kind: "fuzzy_span_suspicious",
    applied: false
  });
  assert.equal(
    formatCliOutput({ exitCode: 1, stdout, stderr: "" }),
    "fuzzy_span_suspicious: fuzzy match span is suspiciously wide for the old string"
  );
});

test("formatCliOutput surfaces empty path invalid_input (CLI 0.28+)", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "path must not be empty",
    error_kind: "invalid_input",
    applied: false
  });
  assert.equal(
    formatCliOutput({ exitCode: 1, stdout, stderr: "" }),
    "invalid_input: path must not be empty"
  );
});

test("formatCliOutput surfaces parent path invalid_input (CLI 0.31+)", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "parent path is not a directory: /tmp/notdir",
    error_kind: "invalid_input",
    applied: false
  });
  assert.equal(
    formatCliOutput({ exitCode: 1, stdout, stderr: "" }),
    "invalid_input: parent path is not a directory: /tmp/notdir"
  );
});

test("formatCliOutput surfaces numeric selector invalid_input (CLI 0.30+)", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: "selector error: comparison operand must be numeric (got 'abc' after >)",
    error_kind: "invalid_input",
    applied: false
  });
  assert.equal(
    formatCliOutput({ exitCode: 1, stdout, stderr: "" }),
    "invalid_input: selector error: comparison operand must be numeric (got 'abc' after >)"
  );
});

test("formatCliOutput surfaces no_matches kind from stderr (CLI 0.29+)", () => {
  const stderr = JSON.stringify({
    ok: false,
    error: "no files without matches for 'TODO' in /tmp/ws",
    error_kind: "no_matches"
  });
  assert.equal(
    formatCliOutput({ exitCode: 3, stdout: "", stderr }),
    "no_matches: no files without matches for 'TODO' in /tmp/ws"
  );
});

test("formatCliOutput falls through when stdout starts with { but is not JSON", () => {
  const result = formatCliOutput({
    exitCode: 1,
    stdout: "{not valid json",
    stderr: "fallback text"
  });
  assert.equal(result, "fallback text {not valid json");
});

test("formatCliOutput appends suggested_op when present (CLI 0.27+)", () => {
  const stdout = JSON.stringify({
    ok: false,
    error:
      "selector uses wildcard/predicate, which is not valid for doc.set (single path only)",
    error_kind: "invalid_input",
    suggested_op: "doc.update",
    applied: false
  });
  assert.equal(
    formatCliOutput({ exitCode: 1, stdout, stderr: "" }),
    "invalid_input: selector uses wildcard/predicate, which is not valid for doc.set (single path only) (suggested_op: doc.update)"
  );
});

test("formatCliOutput surfaces ambiguous kind (CLI 0.25+)", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: 'ambiguous heading: "H" matches 2 times',
    error_kind: "ambiguous",
    applied: false
  });
  assert.equal(
    formatCliOutput({ exitCode: 1, stdout, stderr: "" }),
    'ambiguous: ambiguous heading: "H" matches 2 times'
  );
});

test("classifyAgentsFile returns missing when AGENTS.md does not exist", () => {
  assert.equal(classifyAgentsFile(undefined, "# Rules\n"), "missing");
});

test("classifyAgentsFile treats CRLF and trailing newline differences as up to date", () => {
  assert.equal(classifyAgentsFile("# Rules\r\n- One\r\n", "# Rules\n- One\n\n"), "up_to_date");
});

test("classifyAgentsFile detects real content drift", () => {
  assert.equal(classifyAgentsFile("# Rules\n- One\n", "# Rules\n- Two\n"), "different");
});

test("classifyAgentsFile + normalize handles trailing ws + CRLF variants (new coverage for #154)", () => {
  assert.equal(classifyAgentsFile("# Rules\n- One \n \n", "# Rules\n- One\n"), "up_to_date");
});

test("buildStatusDetails includes workspace readiness context", () => {
  const details = buildStatusDetails(
    {
      ready: true,
      source: "path",
      message: "Using Patchloom from PATH.",
      binaryPath: "/usr/local/bin/patchloom",
      version: "patchloom 0.1.0"
    },
    {
      hasWorkspace: true,
      workspaceName: "demo",
      hasAgentsFile: false,
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    }
  );

  assert.match(details, /Patchloom is ready\./);
  assert.match(details, /Source: PATH/);
  assert.match(details, /Workspace: demo/);
  assert.match(details, /Environment: Local/);
  assert.match(details, /AGENTS\.md: missing/);
});

test("preferredStatusAction points missing binary users to settings", () => {
  const action = preferredStatusAction(
    {
      ready: false,
      source: "missing",
      message: "Patchloom binary not found."
    },
    {
      hasWorkspace: true,
      workspaceName: "demo",
      hasAgentsFile: false,
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    }
  );

  assert.deepEqual(action, {
    title: "Open Settings",
    command: "patchloom.openPatchloomSettings"
  });
});

test("preferredStatusAction suggests install when binary missing with managed install available", () => {
  const action = preferredStatusAction(
    {
      ready: false,
      source: "missing",
      message: "Patchloom binary not found.",
      managedInstall: {
        exists: false,
        binaryPath: "/tmp/patchloom-managed/managed-bin/patchloom",
        target: {
          platform: "darwin",
          arch: "arm64",
          targetTriple: "aarch64-apple-darwin",
          archiveFormat: ".tar.xz"
        }
      }
    },
    {
      hasWorkspace: true,
      workspaceName: "demo",
      hasAgentsFile: false,
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    }
  );

  assert.deepEqual(action, {
    title: "Install Patchloom",
    command: "patchloom.installBinary"
  });
});

test("buildStatusDetails includes compatibility upgrade guidance", () => {
  const details = buildStatusDetails({
    ready: true,
    source: "path",
    message: "Using Patchloom from PATH.",
    binaryPath: "/usr/local/bin/patchloom",
    version: "patchloom 0.0.9",
    detectedVersion: "0.0.9",
    compatibility: "unsupported",
    minimumSupportedVersion: MINIMUM_SUPPORTED_PATCHLOOM_VERSION,
    compatibilityMessage: `Patchloom 0.0.9 is older than the minimum supported version ${MINIMUM_SUPPORTED_PATCHLOOM_VERSION}.`
  }, {
    hasWorkspace: true,
    hasAgentsFile: true,
    hasMcpConfig: true,
    workspaceCount: 2,
    environmentLabel: "WSL",
    environmentSupport: "limited",
    environmentNote: "Workspace-scoped Patchloom commands are supported."
  });

  assert.match(details, /Detected CLI version: 0\.0\.9/);
  assert.match(details, new RegExp(`Required CLI version: >= ${MINIMUM_SUPPORTED_PATCHLOOM_VERSION.replace(/\./g, "\\.")}`));
  assert.match(details, /CLI compatibility: upgrade required/);
  assert.match(details, /Environment: WSL/);
  assert.match(details, /Environment support: limited/);
  assert.match(details, /Workspace folders: 2/);
  assert.match(details, /older than the minimum supported version/);
});

test("buildStatusDetails surfaces managed install failure diagnostics", () => {
  const details = buildStatusDetails({
    ready: false,
    source: "missing",
    message: "Patchloom binary not found.",
    compatibility: "unknown",
    managedInstall: {
      exists: false,
      binaryPath: "/managed/install/managed-bin/patchloom",
      target: {
        platform: "darwin",
        arch: "arm64",
        targetTriple: "aarch64-apple-darwin",
        archiveFormat: ".tar.xz"
      },
      failure: {
        stage: "verify",
        reason: "checksum-mismatch",
        message: "Checksum mismatch for patchloom-aarch64-apple-darwin.tar.xz."
      }
    },
    diagnostics: [
      "Managed install last failure stage: verify",
      "Managed install last failure reason: checksum-mismatch",
      "Managed install diagnostic: Checksum mismatch for patchloom-aarch64-apple-darwin.tar.xz."
    ]
  }, {
    hasWorkspace: false,
    workspaceCount: 0,
    environmentLabel: "Local",
    environmentSupport: "supported"
  });

  assert.match(details, /Managed install: not installed/);
  assert.match(details, /Managed install last failure: verify \(checksum-mismatch\)/);
  assert.match(details, /Managed install diagnostic: Checksum mismatch/);
});

test("preferredStatusAction points outdated PATH CLI users to releases", () => {
  // PATH wins over managed install; Install managed would not replace the active binary.
  const action = preferredStatusAction({
    ready: true,
    source: "path",
    message: "Using Patchloom from PATH.",
    binaryPath: "/usr/local/bin/patchloom",
    version: "patchloom 0.0.9",
    detectedVersion: "0.0.9",
    compatibility: "unsupported",
    minimumSupportedVersion: MINIMUM_SUPPORTED_PATCHLOOM_VERSION,
    compatibilityMessage: `Patchloom 0.0.9 is older than the minimum supported version ${MINIMUM_SUPPORTED_PATCHLOOM_VERSION}.`,
    managedInstall: {
      exists: false,
      binaryPath: "/managed/managed-bin/patchloom",
      target: {
        platform: "darwin",
        arch: "arm64",
        targetTriple: "aarch64-apple-darwin",
        archiveFormat: ".tar.xz"
      }
    }
  });

  assert.deepEqual(action, {
    title: "Open Releases",
    command: "patchloom.openPatchloomReleases"
  });
});

test("preferredStatusAction points outdated managed CLI users to update", () => {
  const action = preferredStatusAction({
    ready: true,
    source: "managed",
    message: "Using managed Patchloom install.",
    binaryPath: "/managed/managed-bin/patchloom",
    version: "patchloom 0.0.9",
    detectedVersion: "0.0.9",
    compatibility: "unsupported",
    minimumSupportedVersion: MINIMUM_SUPPORTED_PATCHLOOM_VERSION,
    compatibilityMessage: `Patchloom 0.0.9 is older than the minimum supported version ${MINIMUM_SUPPORTED_PATCHLOOM_VERSION}.`,
    managedInstall: {
      exists: true,
      binaryPath: "/managed/managed-bin/patchloom",
      target: {
        platform: "darwin",
        arch: "arm64",
        targetTriple: "aarch64-apple-darwin",
        archiveFormat: ".tar.xz"
      }
    }
  });

  assert.deepEqual(action, {
    title: "Update Patchloom",
    command: "patchloom.updateBinary"
  });
});

test("preferredStatusAction falls back to releases when managed install unavailable", () => {
  const action = preferredStatusAction({
    ready: true,
    source: "path",
    message: "Using Patchloom from PATH.",
    binaryPath: "/usr/local/bin/patchloom",
    version: "patchloom 0.0.9",
    detectedVersion: "0.0.9",
    compatibility: "unsupported",
    minimumSupportedVersion: MINIMUM_SUPPORTED_PATCHLOOM_VERSION,
    compatibilityMessage: `Patchloom 0.0.9 is older than the minimum supported version ${MINIMUM_SUPPORTED_PATCHLOOM_VERSION}.`
  });

  assert.deepEqual(action, {
    title: "Open Releases",
    command: "patchloom.openPatchloomReleases"
  });
});

test("preferredStatusAction points ready workspaces without AGENTS to initialization", () => {
  const action = preferredStatusAction(
    {
      ready: true,
      source: "path",
      message: "Using Patchloom from PATH.",
      binaryPath: "/usr/local/bin/patchloom",
      version: "patchloom 0.1.0"
    },
    {
      hasWorkspace: true,
      workspaceName: "demo",
      hasAgentsFile: false,
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    }
  );

  assert.deepEqual(action, {
    title: "Initialize Project",
    command: "patchloom.initializeProject"
  });
});

test("preferredStatusAction points ready workspaces without MCP config to MCP setup", () => {
  const action = preferredStatusAction(
    {
      ready: true,
      source: "path",
      message: "Using Patchloom from PATH.",
      binaryPath: "/usr/local/bin/patchloom",
      version: "patchloom 0.1.0"
    },
    {
      hasWorkspace: true,
      workspaceName: "demo",
      hasAgentsFile: true,
      hasMcpConfig: false,
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    }
  );

  assert.deepEqual(action, {
    title: "Configure MCP",
    command: "patchloom.configureMcp"
  });
});

test("preferredStatusAction returns nothing when workspace is already ready", () => {
  const action = preferredStatusAction(
    {
      ready: true,
      source: "path",
      message: "Using Patchloom from PATH.",
      binaryPath: "/usr/local/bin/patchloom",
      version: "patchloom 0.1.0"
    },
    {
      hasWorkspace: true,
      workspaceName: "demo",
      hasAgentsFile: true,
      hasMcpConfig: true,
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    }
  );

  assert.equal(action, undefined);
});

test("preferredStatusAction returns nothing when workspace readiness is undefined", () => {
  const action = preferredStatusAction(
    {
      ready: true,
      source: "path",
      message: "Using Patchloom from PATH.",
      binaryPath: "/usr/local/bin/patchloom",
      version: "patchloom 0.1.0"
    },
    undefined
  );

  assert.equal(action, undefined);
});

test("buildPatchloomMcpEntry points at patchloom mcp-server", () => {
  assert.deepEqual(buildPatchloomMcpEntry("/usr/local/bin/patchloom"), {
    command: "/usr/local/bin/patchloom",
    args: ["mcp-server"]
  });
});

test("inspectMcpTargets reports configured targets", async () => {
  const targets = await inspectMcpTargets({
    workspaceFolderPath: "/workspace/demo",
    homeDir: "/Users/demo",
    readFile: async (filePath) => {
      if (filePath.endsWith(path.join(".vscode", "mcp.json"))) {
        return '{"servers":{"patchloom":{"command":"patchloom","args":["mcp-server"]}}}';
      }
      return undefined;
    }
  });

  assert.equal(targets.length, 3, "should return vscode-workspace, cursor-workspace, windsurf-user");
  const vscode = targets.find((t) => t.kind === "vscode-workspace");
  const cursor = targets.find((t) => t.kind === "cursor-workspace");
  const windsurf = targets.find((t) => t.kind === "windsurf-user");
  assert.ok(vscode);
  assert.equal(vscode.configured, true, "vscode-workspace should be configured");
  assert.ok(cursor);
  assert.equal(cursor.configured, false, "cursor-workspace should not be configured");
  assert.ok(windsurf);
  assert.equal(windsurf.configured, false, "windsurf-user should not be configured");
});

test("configureMcpTargets creates or updates only the selected target kinds", async () => {
  const writes = new Map<string, string>();
  const results = await configureMcpTargets({
    workspaceFolderPath: "/workspace/demo",
    homeDir: "/Users/demo",
    includeKinds: ["cursor-workspace"],
    patchloomPathSetting: "/custom/patchloom",
    readFile: async (filePath) => {
      if (filePath.endsWith(path.join(".cursor", "mcp.json"))) {
        return '{"servers":{"other":{"command":"other"}}}';
      }
      return undefined;
    },
    writeFile: async (filePath, content) => {
      writes.set(filePath, content);
    }
  });

  assert.equal(results.length, 1);
  const cursorPath = path.join("/workspace/demo", ".cursor", "mcp.json");
  assert.equal(writes.has(cursorPath), true);
  assert.equal(writes.has(path.join("/workspace/demo", ".vscode", "mcp.json")), false);
  assert.match(writes.get(cursorPath) ?? "", /patchloom/);
  assert.match(writes.get(cursorPath) ?? "", /mcp-server/);
  assert.match(writes.get(cursorPath) ?? "", /other/);
});

test("buildAgentRulesArgs omits default all modes", () => {
  assert.deepEqual(buildAgentRulesArgs(), ["agent-rules"]);
  assert.deepEqual(buildAgentRulesArgs({ mode: "all", platform: "all" }), ["agent-rules"]);
  assert.deepEqual(buildAgentRulesArgs({ surface: "full" }), ["agent-rules"]);
});

test("buildAgentRulesArgs includes non-default mode and platform", () => {
  assert.deepEqual(buildAgentRulesArgs({ mode: "mcp" }), ["agent-rules", "--mode", "mcp"]);
  assert.deepEqual(buildAgentRulesArgs({ platform: "windows" }), [
    "agent-rules",
    "--platform",
    "windows"
  ]);
  assert.deepEqual(buildAgentRulesArgs({ mode: "cli", platform: "linux" }), [
    "agent-rules",
    "--mode",
    "cli",
    "--platform",
    "linux"
  ]);
});

test("buildAgentRulesArgs includes --surface core (CLI 0.24+)", () => {
  assert.deepEqual(buildAgentRulesArgs({ surface: "core" }), [
    "agent-rules",
    "--surface",
    "core"
  ]);
  assert.deepEqual(
    buildAgentRulesArgs({ mode: "mcp", platform: "linux", surface: "core" }),
    ["agent-rules", "--mode", "mcp", "--platform", "linux", "--surface", "core"]
  );
});

test("generateAgentRules merges extraEnv into execFile env", async () => {
  let seenEnv: NodeJS.ProcessEnv | undefined;
  const output = await generateAgentRules("/fake/patchloom", "/tmp", {}, {
    extraEnv: { PATCHLOOM_LOG: "debug" },
    processEnv: { PATH: "/usr/bin", HOME: "/home/user" },
    execFile: async (_file, _args, options) => {
      assert.equal(_file, "/fake/patchloom");
      assert.deepEqual([..._args], buildAgentRulesArgs());
      seenEnv = options.env;
      return { stdout: "# rules\n", stderr: "" };
    }
  });
  assert.equal(output, "# rules\n");
  assert.ok(seenEnv);
  assert.equal(seenEnv.PATH, "/usr/bin");
  assert.equal(seenEnv.HOME, "/home/user");
  assert.equal(seenEnv.PATCHLOOM_LOG, "debug");
});

test("generateAgentRules logs command and streams when trace is verbose", async () => {
  const commands: { binary: string; args: readonly string[]; cwd: string }[] = [];
  const logged: { exitCode: number; stdout: string; stderr: string }[] = [];
  setPatchloomLog({
    log() {},
    logCommand(binary, args, cwd) { commands.push({ binary, args, cwd }); },
    logResult(exitCode, stdout, stderr) { logged.push({ exitCode, stdout, stderr }); },
    show() {},
    dispose() {}
  });
  try {
    await generateAgentRules("/fake/patchloom", "/tmp", {}, {
      trace: "verbose",
      execFile: async (_file, _args) => {
        assert.equal(_file, "/fake/patchloom");
        assert.deepEqual([..._args], buildAgentRulesArgs());
        return { stdout: "# rules\n", stderr: "note" };
      }
    });
    assert.equal(commands.length, 1);
    assert.equal(commands[0].binary, "/fake/patchloom");
    assert.deepEqual(commands[0].args, ["agent-rules"]);
    assert.equal(logged.length, 1);
    assert.equal(logged[0].stdout, "# rules\n");
    assert.equal(logged[0].stderr, "note");
  } finally {
    setPatchloomLog(undefined);
  }
});

test("generateAgentRules skips CLI logs when trace is off", async () => {
  let commands = 0;
  let results = 0;
  setPatchloomLog({
    log() {},
    logCommand() { commands += 1; },
    logResult() { results += 1; },
    show() {},
    dispose() {}
  });
  try {
    await generateAgentRules("/fake/patchloom", "/tmp", {}, {
      execFile: async (_file, _args) => {
        assert.equal(_file, "/fake/patchloom");
        assert.deepEqual([..._args], buildAgentRulesArgs());
        return { stdout: "# rules\n", stderr: "" };
      }
    });
    assert.equal(commands, 0);
    assert.equal(results, 0);
  } finally {
    setPatchloomLog(undefined);
  }
});

test("generateAgentRules extraEnv overwrites processEnv keys", async () => {
  let seenEnv: NodeJS.ProcessEnv | undefined;
  await generateAgentRules("/fake/patchloom", "/tmp", {}, {
    extraEnv: { PATCHLOOM_LOG: "debug" },
    processEnv: { PATH: "/usr/bin", PATCHLOOM_LOG: "info" },
    execFile: async (_file, _args, options) => {
      assert.equal(_file, "/fake/patchloom");
      assert.deepEqual([..._args], buildAgentRulesArgs());
      seenEnv = options.env;
      return { stdout: "# rules\n", stderr: "" };
    }
  });
  assert.ok(seenEnv);
  assert.equal(seenEnv.PATCHLOOM_LOG, "debug");
  assert.equal(seenEnv.PATH, "/usr/bin");
});

test("generateAgentRules logs error to output channel on CLI failure", async () => {
  const logged: { exitCode: number; stdout: string; stderr: string }[] = [];
  const commands: { binary: string; args: readonly string[]; cwd: string }[] = [];
  setPatchloomLog({
    log() {},
    logCommand(binary, args, cwd) { commands.push({ binary, args, cwd }); },
    logResult(exitCode, stdout, stderr) { logged.push({ exitCode, stdout, stderr }); },
    show() {},
    dispose() {}
  });
  try {
    await assert.rejects(
      () => generateAgentRules("/nonexistent/patchloom", "/tmp", { mode: "mcp", platform: "linux" }, {
        trace: "verbose"
      }),
      (err: Error) => {
        assert.match(err.message, /ENOENT|not found|No such file/i);
        return true;
      }
    );
    assert.equal(commands.length, 1, "logCommand should be called once");
    assert.equal(commands[0].binary, "/nonexistent/patchloom");
    assert.deepEqual(commands[0].args, ["agent-rules", "--mode", "mcp", "--platform", "linux"]);
    assert.equal(commands[0].cwd, "/tmp");
    assert.equal(logged.length, 1, "logResult should be called once on failure");
    assert.equal(logged[0].exitCode, 1);
  } finally {
    setPatchloomLog(undefined);
  }
});

test("generateAgentRules surfaces formatCliOutput envelope on CLI failure", async () => {
  const logged: { exitCode: number; stdout: string; stderr: string }[] = [];
  setPatchloomLog({
    log() {},
    logCommand() {},
    logResult(exitCode, stdout, stderr) { logged.push({ exitCode, stdout, stderr }); },
    show() {},
    dispose() {}
  });
  const stdout = JSON.stringify({
    ok: false,
    error: "selector uses wildcard/predicate, which is not valid for doc.set (single path only)",
    error_kind: "invalid_input",
    suggested_op: "doc.update",
    applied: false
  });
  const execError = Object.assign(new Error("Command failed: patchloom agent-rules"), {
    code: 1,
    stdout,
    stderr: ""
  });
  try {
    await assert.rejects(
      () => generateAgentRules("/fake/patchloom", "/tmp", {}, {
        trace: "verbose",
        execFile: async (_file, _args) => {
          assert.equal(_file, "/fake/patchloom");
          assert.deepEqual([..._args], buildAgentRulesArgs());
          throw execError;
        }
      }),
      (err: Error) => {
        assert.match(err.message, /invalid_input/);
        assert.match(err.message, /suggested_op: doc\.update/);
        return true;
      }
    );
    assert.equal(logged.length, 1, "logResult should be called once on failure");
    assert.match(`${logged[0].stdout}\n${logged[0].stderr}`, /invalid_input|suggested_op/);
  } finally {
    setPatchloomLog(undefined);
  }
});

test("isMissingFileError is true for FileNotFound-shaped errors", () => {
  assert.equal(isMissingFileError({ code: "FileNotFound" }), true);
  assert.equal(isMissingFileError({
    code: "FileNotFound",
    name: "EntryNotFound (FileSystemError)"
  }), true);
});

test("isMissingFileError is false for permission-shaped errors", () => {
  assert.equal(isMissingFileError({ code: "NoPermissions" }), false);
  assert.equal(isMissingFileError({ code: "Unavailable" }), false);
});

test("isMissingFileError is false for generic Error", () => {
  assert.equal(isMissingFileError(new Error("EACCES: permission denied")), false);
  assert.equal(isMissingFileError("disk full"), false);
  assert.equal(isMissingFileError(null), false);
  assert.equal(isMissingFileError(undefined), false);
});
