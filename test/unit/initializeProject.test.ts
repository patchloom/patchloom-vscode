import assert from "node:assert/strict";
import * as path from "node:path";
import test from "node:test";
import { MINIMUM_SUPPORTED_PATCHLOOM_VERSION } from "../../src/binary/patchloom.js";
import {
  buildAgentRulesArgs,
  classifyAgentsFile,
  generateAgentRules
} from "../../src/commands/initializeProject.js";
import { buildStatusDetails, preferredStatusAction } from "../../src/commands/showStatus.js";
import { buildPatchloomMcpEntry, configureMcpTargets, inspectMcpTargets } from "../../src/mcp/config.js";
import { setPatchloomLog } from "../../src/logging/outputChannel.js";
import { formatCliOutput, formatError } from "../../src/util.js";

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

test("preferredStatusAction points outdated CLI users to releases", () => {
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
      () => generateAgentRules("/nonexistent/patchloom", "/tmp", { mode: "mcp", platform: "linux" }),
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
