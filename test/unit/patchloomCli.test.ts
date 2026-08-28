/**
 * Integration tests that invoke the real patchloom binary.
 *
 * These tests exercise the actual boundary between the extension and the CLI:
 * process spawning, argument formatting, output parsing, and exit code handling.
 *
 * Skipped automatically if patchloom is not available on PATH or at a known
 * build location, so CI without patchloom installed still passes.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import test, { describe } from "node:test";
import {
  findOnPath,
  parsePatchloomVersion,
  comparePatchloomVersions,
  assessPatchloomCompatibility,
  resolvePatchloomStatusWithInputs
} from "../../src/binary/patchloom.js";
import { classifyAgentsFile, generateAgentRules } from "../../src/commands/initializeProject.js";
import { buildStatusDetails, preferredStatusAction } from "../../src/commands/showStatus.js";
import {
  buildCreateQuickAction,
  buildDocDeleteWhereQuickAction,
  buildDocGetQuickAction,
  buildDocMergeQuickAction,
  buildDocSetQuickAction,
  buildDocUpdateQuickAction,
  buildApplyFragmentQuickAction,
  buildInsertAfterMatchQuickAction,
  buildReplaceQuickAction,
  buildSearchQuickAction,
  retargetQuickAction,
  withApplyFlag
} from "../../src/commands/quickActions.js";
import { configureMcpTargets, inspectMcpTargets } from "../../src/mcp/config.js";
import { performManagedInstall } from "../../src/install/managed.js";
import { formatCliOutput } from "../../src/util.js";

const execFileAsync = promisify(execFile);

const KNOWN_BUILD_PATHS = [
  path.join(os.homedir(), "patchloom", "target", "release", "patchloom"),
  path.join(os.homedir(), "patchloom", "target", "debug", "patchloom")
];

async function findPatchloom(): Promise<string | undefined> {
  // Try PATH first
  const onPath = await findOnPath(process.env.PATH, process.platform);
  if (onPath) {
    return onPath;
  }

  // Fall back to known build locations
  for (const p of KNOWN_BUILD_PATHS) {
    try {
      await fs.access(p, fsConstants.X_OK);
      return p;
    } catch {
      // not found, try next
    }
  }

  return undefined;
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "patchloom-cli-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("patchloom CLI integration", async () => {
  const binaryPath = await findPatchloom();
  if (!binaryPath) {
    test("skipped: patchloom binary not found", { skip: "patchloom not on PATH or at known build path" }, () => {});
    return;
  }

  test("--version returns parseable version string", async () => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const output = `${stdout}${stderr}`.trim();
    assert.ok(output.length > 0, "version output should not be empty");

    const version = parsePatchloomVersion(output);
    assert.ok(version, `should parse a version from: ${output}`);
    assert.match(version, /^\d+\.\d+\.\d+/, "version should be semver");
  });

  test("--version output passes compatibility assessment", async () => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const output = `${stdout}${stderr}`.trim();
    const assessment = assessPatchloomCompatibility(output);
    assert.equal(assessment.compatibility, "supported",
      `installed patchloom should be compatible: ${assessment.message}`);
  });

  test("resolvePatchloomStatusWithInputs discovers the real binary", async () => {
    const status = await resolvePatchloomStatusWithInputs({
      configuredPath: binaryPath
    });

    assert.equal(status.ready, true);
    assert.equal(status.source, "setting");
    assert.ok(status.version, "should have a version string");
    assert.ok(status.binaryPath, "should have a binary path");
  });

  test("agent-rules produces markdown output", async () => {
    await withTempDir(async (dir) => {
      const { stdout } = await execFileAsync(binaryPath, ["agent-rules"], {
        cwd: dir,
        timeout: 10000
      });

      assert.ok(stdout.length > 100, "agent-rules output should be substantial");
      assert.match(stdout, /patchloom/i, "output should mention patchloom");
      assert.match(stdout, /^#/m, "output should contain markdown headings");
    });
  });

  test("doc set modifies a JSON file by selector", async () => {
    await withTempDir(async (dir) => {
      const jsonFile = path.join(dir, "config.json");
      await fs.writeFile(jsonFile, JSON.stringify({ server: { port: 3000 } }), "utf8");

      await execFileAsync(binaryPath, [
        "doc", "set", jsonFile, "server.port", "8080", "--apply"
      ], { cwd: dir, timeout: 5000 });

      const result = JSON.parse(await fs.readFile(jsonFile, "utf8")) as Record<string, Record<string, unknown>>;
      assert.equal(result.server.port, 8080, "port should be updated to 8080");
    });
  });

  test("doc set preserves YAML comments", async () => {
    await withTempDir(async (dir) => {
      const yamlFile = path.join(dir, "config.yaml");
      await fs.writeFile(yamlFile, [
        "# Server configuration",
        "server:",
        "  host: localhost  # local only",
        "  port: 3000",
        ""
      ].join("\n"), "utf8");

      await execFileAsync(binaryPath, [
        "doc", "set", yamlFile, "server.port", "9090", "--apply"
      ], { cwd: dir, timeout: 5000 });

      const result = await fs.readFile(yamlFile, "utf8");
      assert.match(result, /# Server configuration/, "top comment should be preserved");
      assert.match(result, /# local only/, "inline comment should be preserved");
      assert.match(result, /9090/, "port should be updated");
    });
  });

  test("replace performs text substitution in a file", async () => {
    await withTempDir(async (dir) => {
      const txtFile = path.join(dir, "readme.txt");
      await fs.writeFile(txtFile, "Hello old_name, welcome to old_name project.\n", "utf8");

      await execFileAsync(binaryPath, [
        "replace", "old_name", "--new", "new_name", txtFile, "--apply"
      ], { cwd: dir, timeout: 5000 });

      const result = await fs.readFile(txtFile, "utf8");
      assert.ok(!result.includes("old_name"), "old_name should be replaced");
      assert.ok(result.includes("new_name"), "new_name should be present");
    });
  });

  test("tidy fix ensures final newline", async () => {
    await withTempDir(async (dir) => {
      const txtFile = path.join(dir, "no-newline.txt");
      await fs.writeFile(txtFile, "no trailing newline", "utf8");

      await execFileAsync(binaryPath, [
        "tidy", "fix", txtFile, "--ensure-final-newline", "--apply"
      ], { cwd: dir, timeout: 5000 });

      const result = await fs.readFile(txtFile, "utf8");
      assert.ok(result.endsWith("\n"), "file should end with newline after tidy");
    });
  });

  test("search finds text across files", async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, "a.txt"), "hello world\n", "utf8");
      await fs.writeFile(path.join(dir, "b.txt"), "goodbye world\n", "utf8");

      const { stdout } = await execFileAsync(binaryPath, [
        "search", "world", dir, "--json"
      ], { timeout: 5000 });

      const result = JSON.parse(stdout) as { match_count: number };
      assert.equal(result.match_count, 2, "should find 'world' in both files");
    });
  });

  test("doc get reads a value by selector", async () => {
    await withTempDir(async (dir) => {
      const jsonFile = path.join(dir, "data.json");
      await fs.writeFile(jsonFile, JSON.stringify({ version: "1.2.3" }), "utf8");

      const { stdout } = await execFileAsync(binaryPath, [
        "doc", "get", jsonFile, "version"
      ], { timeout: 5000 });

      assert.match(stdout.trim(), /1\.2\.3/, "should output the version value");
    });
  });

  test("batch applies multiple operations via stdin", async () => {
    await withTempDir(async (dir) => {
      const jsonFile = path.join(dir, "package.json");
      const txtFile = path.join(dir, "VERSION");
      await fs.writeFile(jsonFile, JSON.stringify({ version: "1.0.0", name: "test" }), "utf8");
      await fs.writeFile(txtFile, "1.0.0\n", "utf8");

      const batchInput = [
        `doc.set ${jsonFile} version "2.0.0"`,
        `replace ${txtFile} "1.0.0" "2.0.0"`
      ].join("\n");

      const child = execFile(binaryPath, ["batch", "--apply"], { cwd: dir, timeout: 5000 });
      child.stdin!.write(batchInput);
      child.stdin!.end();
      await new Promise<void>((resolve, reject) => {
        child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`batch exited ${code}`)));
        child.on("error", reject);
      });

      const pkg = JSON.parse(await fs.readFile(jsonFile, "utf8")) as Record<string, unknown>;
      assert.equal(pkg.version, "2.0.0", "package.json version should be updated");

      const ver = await fs.readFile(txtFile, "utf8");
      assert.match(ver, /2\.0\.0/, "VERSION file should be updated");
    });
  });

  test("create makes a new file", async () => {
    await withTempDir(async (dir) => {
      const newFile = path.join(dir, "created.txt");

      await execFileAsync(binaryPath, [
        "create", newFile, "--content", "hello from patchloom", "--apply"
      ], { cwd: dir, timeout: 5000 });

      const content = await fs.readFile(newFile, "utf8");
      assert.match(content, /hello from patchloom/, "created file should have the specified content");
    });
  });

  test("exit code 3 for search with no matches", async () => {
    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, "empty.txt"), "nothing here\n", "utf8");

      try {
        await execFileAsync(binaryPath, [
          "search", "NONEXISTENT_STRING_xyz", dir
        ], { timeout: 5000 });
        assert.fail("should have exited with non-zero code");
      } catch (error) {
        const execError = error as Error & { code?: number };
        assert.equal(execError.code, 3, "no-match exit code should be 3");
      }
    });
  });

  test("exit code 2 for replace --check with pending changes", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "check-target.txt");
      await fs.writeFile(file, "hello world\n", "utf8");

      try {
        await execFileAsync(binaryPath, [
          "replace", "hello", "--new", "goodbye", file, "--check"
        ], { timeout: 5000 });
        assert.fail("should have exited with non-zero code");
      } catch (error) {
        const execError = error as Error & { code?: number };
        assert.equal(execError.code, 2, "changes-detected exit code should be 2");
      }

      // File should be unchanged (--check is read-only)
      const content = await fs.readFile(file, "utf8");
      assert.equal(content, "hello world\n", "file must not be modified by --check");
    });
  });

  test("exit code 0 for tidy check on a clean file", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "clean.txt");
      await fs.writeFile(file, "already clean\n", "utf8");

      // File has a final newline and no trailing whitespace; tidy check should exit 0
      await execFileAsync(binaryPath, [
        "tidy", "check", file, "--ensure-final-newline"
      ], { timeout: 5000 });
      // If we get here, exit code was 0 (no issues found)
    });
  });

  test("exit code 2 for tidy check on a file needing fixes", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "dirty.txt");
      await fs.writeFile(file, "no trailing newline", "utf8");

      try {
        await execFileAsync(binaryPath, [
          "tidy", "check", file, "--ensure-final-newline"
        ], { timeout: 5000 });
        assert.fail("should have exited with non-zero code");
      } catch (error) {
        const execError = error as Error & { code?: number };
        assert.equal(execError.code, 2, "tidy check should return 2 for issues found");
      }
    });
  });

  // --- Initialize Project round-trip ---

  test("agent-rules output classified as up_to_date after write", async () => {
    await withTempDir(async (dir) => {
      const first = await generateAgentRules(binaryPath, dir);
      const agentsPath = path.join(dir, "AGENTS.md");
      await fs.writeFile(agentsPath, first, "utf8");

      // Initialize Project generates again, then classifies disk vs that output.
      const second = await generateAgentRules(binaryPath, dir);
      const diskContent = await fs.readFile(agentsPath, "utf8");
      const state = classifyAgentsFile(diskContent, second);
      assert.equal(state, "up_to_date",
        "second agent-rules generate should match the written AGENTS.md");
    });
  });

  test("agent-rules output classified as different after modification", async () => {
    await withTempDir(async (dir) => {
      const { stdout: rules } = await execFileAsync(binaryPath, ["agent-rules"], {
        cwd: dir,
        timeout: 10000
      });

      const content = rules.endsWith("\n") ? rules : `${rules}\n`;
      const modified = content + "\n## Custom section\n\nExtra content.\n";

      const state = classifyAgentsFile(modified, content);
      assert.equal(state, "different",
        "modified agent-rules should be classified as different");
    });
  });

  // --- Quick action preview flow ---

  test("quick action preview flow: copy, apply to copy, compare", async () => {
    await withTempDir(async (dir) => {
      // Original file
      const originalFile = path.join(dir, "original.txt");
      const originalContent = "The quick brown fox jumps over the lazy dog.\n";
      await fs.writeFile(originalFile, originalContent, "utf8");

      // Build the quick action (extension builds these from user input)
      const action = buildReplaceQuickAction(originalFile, "fox", "cat");

      // Simulate the preview flow: copy to temp, retarget, apply
      const previewDir = path.join(dir, "preview");
      await fs.mkdir(previewDir);
      const previewFile = path.join(previewDir, "original.txt");
      await fs.writeFile(previewFile, originalContent, "utf8");

      const previewAction = retargetQuickAction(action, previewFile);
      const applyArgs = withApplyFlag([...previewAction.args]);

      await execFileAsync(binaryPath, applyArgs, { cwd: previewDir, timeout: 5000 });

      // Original is untouched
      const originalAfter = await fs.readFile(originalFile, "utf8");
      assert.equal(originalAfter, originalContent, "original file must not be modified during preview");

      // Preview file has the replacement
      const previewContent = await fs.readFile(previewFile, "utf8");
      assert.ok(previewContent.includes("cat"), "preview should contain the replacement");
      assert.ok(!previewContent.includes("fox"), "preview should not contain the original text");
    });
  });

  // --- Full status details with real binary ---

  test("buildStatusDetails renders real binary status correctly", async () => {
    const status = await resolvePatchloomStatusWithInputs({
      configuredPath: binaryPath
    });

    const details = buildStatusDetails(status, {
      hasWorkspace: true,
      workspaceName: "test-project",
      hasAgentsFile: false,
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    });

    assert.match(details, /Patchloom is ready/, "should report ready");
    assert.match(details, /patchloom\.path/, "should show source as setting");
    assert.ok(details.includes(binaryPath), "should include the binary path");
    assert.match(details, /Workspace: test-project/, "should include workspace name");
    assert.match(details, /AGENTS\.md: missing/, "should report missing AGENTS.md");
  });

  test("preferredStatusAction suggests Initialize Project for real ready status", async () => {
    const status = await resolvePatchloomStatusWithInputs({
      configuredPath: binaryPath
    });

    const action = preferredStatusAction(status, {
      hasWorkspace: true,
      workspaceName: "test",
      hasAgentsFile: false,
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    });

    assert.ok(action, "should suggest an action when AGENTS.md is missing");
    assert.equal(action.command, "patchloom.initializeProject");
  });

  // --- MCP config write then verify server starts ---

  test("mcp-server starts and responds to JSON-RPC initialize", async () => {
    // Check if this binary was built with MCP support
    try {
      await execFileAsync(binaryPath, ["mcp-server", "--help"], { timeout: 5000 });
    } catch {
      // mcp-server not available in this build; skip
      return;
    }

    const child = execFile(binaryPath, ["mcp-server"], { timeout: 10000 });
    let stdout = "";
    child.stdout!.on("data", (data: Buffer) => { stdout += data.toString(); });

    // Send a JSON-RPC initialize request as newline-delimited JSON
    // (patchloom v0.1.2+ uses raw JSON-RPC lines, not Content-Length framing)
    const initRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.1" }
      }
    });
    child.stdin!.write(initRequest + "\n");

    // Wait for the server to respond (it needs to start the tokio runtime)
    const deadline = Date.now() + 5000;
    while (stdout.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    child.kill();

    // Should have received a newline-delimited JSON-RPC response
    assert.ok(stdout.length > 0, "mcp-server should produce output");
    const response = JSON.parse(stdout.trim().split("\n")[0]) as Record<string, unknown>;
    assert.equal(response.jsonrpc, "2.0", "response should be JSON-RPC 2.0");
    assert.equal(response.id, 1, "response id should match request id");
    const result = response.result as Record<string, unknown>;
    assert.ok(result, "response should have a result (not an error)");
    const serverInfo = result.serverInfo as Record<string, string>;
    assert.ok(serverInfo?.name, "response should include serverInfo.name");
  });

  // --- #115: doc mutation CLI tests ---

  test("doc delete removes a key from a JSON file", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "config.json");
      await fs.writeFile(file, '{"keep": 1, "remove": 2}\n', "utf8");

      await execFileAsync(binaryPath, [
        "doc", "delete", file, "remove", "--apply"
      ], { timeout: 5000 });

      const content = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
      assert.equal(content.keep, 1);
      assert.equal(content.remove, undefined, "deleted key should be absent");
    });
  });

  test("doc merge adds keys to a JSON file", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "config.json");
      await fs.writeFile(file, '{"existing": true}\n', "utf8");

      await execFileAsync(binaryPath, [
        "doc", "merge", file, "--value", '{"added": 42}', "--apply"
      ], { timeout: 5000 });

      const content = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
      assert.equal(content.existing, true, "existing key preserved");
      assert.equal(content.added, 42, "merged key present");
    });
  });

  test("doc merge --selector targets multi-document YAML via Quick Action args (CLI 0.16+)", async (t) => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const version = parsePatchloomVersion(`${stdout}${stderr}`);
    if (!version || comparePatchloomVersions(version, "0.16.0") < 0) {
      t.skip(`requires patchloom >= 0.16.0 (found ${version ?? "unknown"})`);
      return;
    }

    await withTempDir(async (dir) => {
      const file = path.join(dir, "multi.yaml");
      await fs.writeFile(file, "---\na: 1\n---\nb: 2\n", "utf8");

      const action = buildDocMergeQuickAction(file, '{"c": 3}', "0");
      await execFileAsync(binaryPath, withApplyFlag(action.args), { timeout: 5000 });

      const content = await fs.readFile(file, "utf8");
      assert.match(content, /a:\s*1/, "first document field preserved");
      assert.match(content, /c:\s*3/, "merged key landed in selected document");
      assert.match(content, /b:\s*2/, "second document preserved");
      // Document 0 is before the second --- separator; merge must not rewrite doc 1 only.
      const secondSep = content.indexOf("---", content.indexOf("---") + 3);
      assert.ok(secondSep > 0, "multi-doc separator should remain");
      assert.ok(content.indexOf("c:") < secondSep, "merged key belongs in first document");
      assert.ok(content.indexOf("b:") > secondSep, "second document body stays after separator");
    });
  });

  test("replace --insert-after via Quick Action args is line-oriented (CLI 0.16+)", async (t) => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const version = parsePatchloomVersion(`${stdout}${stderr}`);
    if (!version || comparePatchloomVersions(version, "0.16.0") < 0) {
      t.skip(`requires patchloom >= 0.16.0 (found ${version ?? "unknown"})`);
      return;
    }

    await withTempDir(async (dir) => {
      const file = path.join(dir, "notes.txt");
      await fs.writeFile(file, "alpha\nbeta\n", "utf8");

      const action = buildInsertAfterMatchQuickAction(file, "beta", "gamma");
      await execFileAsync(binaryPath, withApplyFlag(action.args), { timeout: 5000 });

      const content = await fs.readFile(file, "utf8");
      assert.equal(content, "alpha\nbeta\ngamma\n");
    });
  });

  test("apply-fragment --after via Quick Action args (CLI 0.22+)", async (t) => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const version = parsePatchloomVersion(`${stdout}${stderr}`);
    if (!version || comparePatchloomVersions(version, "0.22.0") < 0) {
      t.skip(`requires patchloom >= 0.22.0 (found ${version ?? "unknown"})`);
      return;
    }

    await withTempDir(async (dir) => {
      const file = path.join(dir, "lib.rs");
      await fs.writeFile(file, "fn foo() {\n  let a = 1;\n}\n", "utf8");

      const action = buildApplyFragmentQuickAction(file, "after", "fn foo() {", "  let x = 2;");
      await execFileAsync(binaryPath, withApplyFlag(action.args), { timeout: 5000 });

      const content = await fs.readFile(file, "utf8");
      assert.equal(content, "fn foo() {\n  let x = 2;\n  let a = 1;\n}\n");
    });
  });

  test("search --files-without-match via Quick Action args (CLI 0.29+)", async (t) => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const version = parsePatchloomVersion(`${stdout}${stderr}`);
    if (!version || comparePatchloomVersions(version, "0.29.0") < 0) {
      t.skip(`requires patchloom >= 0.29.0 (found ${version ?? "unknown"})`);
      return;
    }

    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, "hit.txt"), "TODO\n", "utf8");
      await fs.writeFile(path.join(dir, "miss.txt"), "ok\n", "utf8");

      const action = buildSearchQuickAction(dir, "TODO", undefined, { filesWithoutMatch: true });
      const result = await execFileAsync(binaryPath, ["--json", ...action.args], { timeout: 5000 });
      const parsed = JSON.parse(result.stdout) as {
        files?: Array<{ path?: string }>;
      };
      const files = (parsed.files ?? []).map((entry) => path.basename(entry.path ?? ""));
      assert.ok(files.includes("miss.txt"), "files without the pattern should be listed");
      assert.ok(!files.includes("hit.txt"), "files that contain the pattern should be omitted");
    });
  });

  test("search --files-without-match all-hits is no_matches via Quick Action args (CLI 0.29+)", async (t) => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const version = parsePatchloomVersion(`${stdout}${stderr}`);
    if (!version || comparePatchloomVersions(version, "0.29.0") < 0) {
      t.skip(`requires patchloom >= 0.29.0 (found ${version ?? "unknown"})`);
      return;
    }

    await withTempDir(async (dir) => {
      await fs.writeFile(path.join(dir, "a.txt"), "TODO\n", "utf8");
      await fs.writeFile(path.join(dir, "b.txt"), "TODO\n", "utf8");

      const action = buildSearchQuickAction(dir, "TODO", undefined, { filesWithoutMatch: true });
      try {
        await execFileAsync(binaryPath, ["--json", ...action.args], { timeout: 5000 });
        assert.fail("all-hit --files-without-match should fail");
      } catch (error) {
        const failed = error as { code?: number; stdout?: string; stderr?: string };
        assert.equal(failed.code, 3, "no-match exit code should be 3");
        const payload = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
        assert.match(payload, /no_matches/);
        assert.match(payload, /no files without matches/);
      }
    });
  });

  test("doc get numeric-compare selector via Quick Action args (CLI 0.30+)", async (t) => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const version = parsePatchloomVersion(`${stdout}${stderr}`);
    if (!version || comparePatchloomVersions(version, "0.30.0") < 0) {
      t.skip(`requires patchloom >= 0.30.0 (found ${version ?? "unknown"})`);
      return;
    }

    await withTempDir(async (dir) => {
      const file = path.join(dir, "servers.json");
      await fs.writeFile(
        file,
        JSON.stringify({ servers: [{ name: "a", port: 9000 }, { name: "b", port: 80 }] }),
        "utf8"
      );

      const getAction = buildDocGetQuickAction(file, "servers[port>8000]");
      const result = await execFileAsync(binaryPath, ["--json", ...getAction.args], { timeout: 5000 });
      const parsed = JSON.parse(result.stdout) as { value?: { port?: number } };
      assert.equal(parsed.value?.port, 9000, "numeric compare should return the 9000 entry");

      const badAction = buildDocGetQuickAction(file, "servers[port>abc]");
      try {
        await execFileAsync(binaryPath, ["--json", ...badAction.args], { timeout: 5000 });
        assert.fail("non-numeric comparison operand should fail");
      } catch (error) {
        const failed = error as { code?: number; stdout?: string; stderr?: string };
        const payload = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
        assert.match(payload, /invalid_input/);
        assert.match(payload, /must be numeric/);
        const formatted = formatCliOutput({
          exitCode: typeof failed.code === "number" ? failed.code : 1,
          stdout: failed.stdout ?? "",
          stderr: failed.stderr ?? ""
        });
        assert.match(formatted, /invalid_input/);
        assert.match(formatted, /must be numeric/);
      }
    });
  });

  test("create through a file parent is invalid_input (CLI 0.31+)", async (t) => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const version = parsePatchloomVersion(`${stdout}${stderr}`);
    if (!version || comparePatchloomVersions(version, "0.31.0") < 0) {
      t.skip(`requires patchloom >= 0.31.0 (found ${version ?? "unknown"})`);
      return;
    }

    await withTempDir(async (dir) => {
      const parent = path.join(dir, "notdir");
      await fs.writeFile(parent, "file\n", "utf8");
      const dest = path.join(parent, "child.txt");
      const action = buildCreateQuickAction(dest, "x");

      try {
        await execFileAsync(binaryPath, ["--json", ...action.args], {
          timeout: 5000
        });
        assert.fail("create through a file parent should fail");
      } catch (error) {
        const failed = error as { stdout?: string; stderr?: string };
        const payload = `${failed.stdout ?? ""}${failed.stderr ?? ""}`;
        assert.match(payload, /parent path is not a directory/);
        assert.match(payload, /invalid_input/);
      }
    });
  });

  test("doc set YAML alias via Quick Action args (CLI 0.31+)", async (t) => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const version = parsePatchloomVersion(`${stdout}${stderr}`);
    if (!version || comparePatchloomVersions(version, "0.31.0") < 0) {
      t.skip(`requires patchloom >= 0.31.0 (found ${version ?? "unknown"})`);
      return;
    }

    await withTempDir(async (dir) => {
      const file = path.join(dir, "svc.yaml");
      await fs.writeFile(file, [
        "shared: &shared",
        "  timeout: 30",
        "service_a: *shared",
        ""
      ].join("\n"), "utf8");

      const action = buildDocSetQuickAction(file, "service_a.retries", "3");
      await execFileAsync(binaryPath, withApplyFlag(action.args), { timeout: 5000 });

      const content = await fs.readFile(file, "utf8");
      assert.match(content, /<<: \*shared/, "alias merge key should be preserved");
      assert.match(content, /retries/, "new field should be written onto the alias");
    });
  });

  test("doc update via Quick Action args (CLI 0.27+)", async (t) => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const version = parsePatchloomVersion(`${stdout}${stderr}`);
    if (!version || comparePatchloomVersions(version, "0.27.0") < 0) {
      t.skip(`requires patchloom >= 0.27.0 (found ${version ?? "unknown"})`);
      return;
    }

    await withTempDir(async (dir) => {
      const file = path.join(dir, "data.json");
      await fs.writeFile(
        file,
        JSON.stringify({ items: [{ enabled: true }, { enabled: true }] }),
        "utf8"
      );

      const action = buildDocUpdateQuickAction(file, "items[*].enabled", "false");
      await execFileAsync(binaryPath, withApplyFlag(action.args), { timeout: 5000 });

      const content = JSON.parse(await fs.readFile(file, "utf8")) as { items: Array<{ enabled: boolean }> };
      assert.deepEqual(content.items, [{ enabled: false }, { enabled: false }]);
    });
  });

  test("doc delete-where via Quick Action args (CLI 0.27+)", async (t) => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const version = parsePatchloomVersion(`${stdout}${stderr}`);
    if (!version || comparePatchloomVersions(version, "0.27.0") < 0) {
      t.skip(`requires patchloom >= 0.27.0 (found ${version ?? "unknown"})`);
      return;
    }

    await withTempDir(async (dir) => {
      const file = path.join(dir, "data.json");
      await fs.writeFile(
        file,
        JSON.stringify({ items: [{ name: "keep" }, { name: "stale" }] }),
        "utf8"
      );

      const action = buildDocDeleteWhereQuickAction(file, "items", "name=stale");
      await execFileAsync(binaryPath, withApplyFlag(action.args), { timeout: 5000 });

      const content = JSON.parse(await fs.readFile(file, "utf8")) as { items: Array<{ name: string }> };
      assert.deepEqual(content.items, [{ name: "keep" }]);
    });
  });

  test("generateAgentRules core surface honors mode (CLI 0.29+)", async (t) => {
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 5000 });
    const version = parsePatchloomVersion(`${stdout}${stderr}`);
    if (!version || comparePatchloomVersions(version, "0.29.0") < 0) {
      t.skip(`requires patchloom >= 0.29.0 (found ${version ?? "unknown"})`);
      return;
    }

    await withTempDir(async (dir) => {
      const mcp = await generateAgentRules(binaryPath, dir, { surface: "core", mode: "mcp" });
      const cli = await generateAgentRules(binaryPath, dir, { surface: "core", mode: "cli" });
      assert.match(mcp, /^#/m, "core mcp rules should be markdown");
      assert.match(cli, /^#/m, "core cli rules should be markdown");
      assert.notEqual(mcp, cli, "core mcp and cli texts should differ");
    });
  });

  test("doc append adds an item to a JSON array", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "config.json");
      await fs.writeFile(file, '{"tags": ["a", "b"]}\n', "utf8");

      await execFileAsync(binaryPath, [
        "doc", "append", file, "tags", '"c"', "--apply"
      ], { timeout: 5000 });

      const content = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
      assert.deepEqual(content.tags, ["a", "b", "c"]);
    });
  });

  // --- #114: markdown CLI tests ---

  test("md upsert-bullet adds a bullet under a heading", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "doc.md");
      await fs.writeFile(file, "# Rules\n\n- Existing rule\n", "utf8");

      await execFileAsync(binaryPath, [
        "md", "upsert-bullet", file,
        "--heading", "# Rules",
        "--bullet", "New rule",
        "--apply"
      ], { timeout: 5000 });

      const content = await fs.readFile(file, "utf8");
      assert.ok(content.includes("- New rule"), "new bullet should be present");
      assert.ok(content.includes("- Existing rule"), "existing bullet should be preserved");
    });
  });

  test("md table-append adds a row to a markdown table", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "doc.md");
      await fs.writeFile(file, "# API\n\n| Route | Method |\n|---|---|\n| /health | GET |\n", "utf8");

      await execFileAsync(binaryPath, [
        "md", "table-append", file,
        "--heading", "# API",
        "--row", "| /users | POST |",
        "--apply"
      ], { timeout: 5000 });

      const content = await fs.readFile(file, "utf8");
      assert.ok(content.includes("| /users | POST |"), "appended row should be present");
      assert.ok(content.includes("| /health | GET |"), "existing row should be preserved");
    });
  });

  test("md insert-after-section inserts a sibling after the full section body", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "notes.md");
      await fs.writeFile(
        file,
        "# Title\n\n## Config\n\nsettings here\n\n## Other\n\nbody\n",
        "utf8"
      );

      await execFileAsync(binaryPath, [
        "md", "insert-after-section", file,
        "--heading", "## Config",
        "--content", "## FAQ\n\nCommon questions.\n",
        "--apply"
      ], { timeout: 5000 });

      const content = await fs.readFile(file, "utf8");
      assert.ok(content.includes("## FAQ"), "sibling FAQ heading should be present");
      assert.ok(content.includes("Common questions."), "FAQ body should be present");
      assert.ok(content.includes("settings here"), "Config body should be preserved");
      assert.ok(content.includes("## Other"), "following Other section should remain");

      // Sibling placement: FAQ must come after the Config body, before Other.
      const faqIdx = content.indexOf("## FAQ");
      const settingsIdx = content.indexOf("settings here");
      const otherIdx = content.indexOf("## Other");
      assert.ok(settingsIdx >= 0 && faqIdx > settingsIdx, "FAQ should appear after Config body");
      assert.ok(otherIdx > faqIdx, "FAQ should appear before the next original section");
    });
  });

  // --- #116: undo CLI test ---

  test("undo restores files after an apply", async () => {
    await withTempDir(async (dir) => {
      const file = path.join(dir, "target.txt");
      await fs.writeFile(file, "original content\n", "utf8");

      // Apply a change (creates a backup)
      await execFileAsync(binaryPath, [
        "replace", "original", "--new", "modified", file, "--apply"
      ], { cwd: dir, timeout: 5000 });

      const modified = await fs.readFile(file, "utf8");
      assert.ok(modified.includes("modified"), "file should be modified after apply");

      // Undo the change
      await execFileAsync(binaryPath, ["undo", "--apply"], { cwd: dir, timeout: 5000 });

      const restored = await fs.readFile(file, "utf8");
      assert.equal(restored, "original content\n", "file should be restored after undo");
    });
  });

  test("MCP config written for real binary is structurally valid", async () => {
    await withTempDir(async (workspace) => {
      const readFile = async (filePath: string) => {
        try { return await fs.readFile(filePath, "utf8"); } catch { return undefined; }
      };
      const writeFile = async (filePath: string, content: string) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      };

      // Write MCP config pointing to the real binary
      await configureMcpTargets({
        workspaceFolderPath: workspace,
        homeDir: workspace,
        includeKinds: ["vscode-workspace"],
        patchloomPathSetting: binaryPath,
        readFile,
        writeFile
      });

      // Read back and verify structure
      const configPath = path.join(workspace, ".vscode", "mcp.json");
      const config = JSON.parse(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
      const servers = config.servers as Record<string, Record<string, unknown>>;
      assert.ok(servers.patchloom, "should have a patchloom server entry");
      assert.equal(servers.patchloom.command, binaryPath, "command should point to real binary");
      assert.deepEqual(servers.patchloom.args, ["mcp-server"], "args should be mcp-server");

      // Verify the config is re-readable by inspectMcpTargets
      const targets = await inspectMcpTargets({
        workspaceFolderPath: workspace,
        homeDir: workspace,
        readFile
      });
      const vscodeTarget = targets.find((t) => t.kind === "vscode-workspace");
      assert.ok(vscodeTarget);
      assert.equal(vscodeTarget.configured, true, "target should be detected as configured");
    });
  });
});

// --- End-to-end: managed install + MCP server ---
//
// Downloads the real patchloom binary via performManagedInstall (no mocks),
// starts the MCP server, sends JSON-RPC requests, and validates responses.
// This proves the full pipeline works on a clean machine with no pre-installed binary.

describe("managed install end-to-end MCP", { timeout: 120_000 }, async () => {
  let installDir: string;
  let binaryPath: string;

  // Install once for all tests in this block
  try {
    installDir = await fs.mkdtemp(path.join(os.tmpdir(), "patchloom-e2e-"));
    const result = await performManagedInstall({ installRoot: installDir });
    binaryPath = result.binaryPath;
  } catch (err) {
    // Network or platform issue; skip all tests in this block
    test("skipped: managed install failed", {
      skip: `managed install unavailable: ${err instanceof Error ? err.message : String(err)}`
    }, () => {});
    return;
  }

  // Verify the binary is executable
  test("managed install produces a runnable binary", async () => {
    // Cold start after fresh managed install can take >30s on some runners/CI; use 60s for robustness.
    const { stdout, stderr } = await execFileAsync(binaryPath, ["--version"], { timeout: 60000 });
    const output = `${stdout}${stderr}`.trim();
    const version = parsePatchloomVersion(output);
    assert.ok(version, `should parse version from managed binary: ${output}`);
    assert.match(version, /^\d+\.\d+\.\d+/);
  });

  test("MCP server responds to initialize", async () => {
    const child = execFile(binaryPath, ["mcp-server"], { timeout: 60000 });
    let stdout = "";
    child.stdout!.on("data", (data: Buffer) => { stdout += data.toString(); });

    const initRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-test", version: "0.0.1" }
      }
    });
    child.stdin!.write(initRequest + "\n");

    const deadline = Date.now() + 10000;
    while (stdout.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    child.kill();

    assert.ok(stdout.length > 0, "mcp-server should produce output");
    const response = JSON.parse(stdout.trim().split("\n")[0]) as Record<string, unknown>;
    assert.equal(response.jsonrpc, "2.0");
    assert.equal(response.id, 1);
    const responseResult = response.result as Record<string, unknown>;
    assert.ok(responseResult, "response should have a result");
    const serverInfo = responseResult.serverInfo as Record<string, string>;
    assert.ok(serverInfo?.name, "response should include serverInfo.name");
  });

  test("MCP server lists available tools", async () => {
    const child = execFile(binaryPath, ["mcp-server"], { timeout: 60000 });
    let stdout = "";
    child.stdout!.on("data", (data: Buffer) => { stdout += data.toString(); });

    // Must initialize first, then list tools
    const initRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-test", version: "0.0.1" }
      }
    });
    child.stdin!.write(initRequest + "\n");

    // Wait for initialize response
    let deadline = Date.now() + 10000;
    while (!stdout.includes('"id":1') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Send initialized notification then tools/list
    const initializedNotification = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    });
    child.stdin!.write(initializedNotification + "\n");

    const toolsRequest = JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list"
    });
    child.stdin!.write(toolsRequest + "\n");

    // Wait for tools/list response
    deadline = Date.now() + 10000;
    while (!stdout.includes('"id":2') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    child.kill();

    // Parse the tools/list response (second JSON line)
    const lines = stdout.trim().split("\n");
    const toolsLine = lines.find((line) => line.includes('"id":2'));
    assert.ok(toolsLine, "should have a tools/list response");

    const toolsResponse = JSON.parse(toolsLine) as Record<string, unknown>;
    assert.equal(toolsResponse.jsonrpc, "2.0");
    assert.equal(toolsResponse.id, 2);
    const toolsResult = toolsResponse.result as Record<string, unknown>;
    assert.ok(toolsResult, "tools/list should have a result");
    const tools = toolsResult.tools as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(tools), "result.tools should be an array");
    assert.ok(tools.length > 0, "should expose at least one tool");

    // Verify tools have required MCP fields
    for (const tool of tools) {
      assert.ok(typeof tool.name === "string" && tool.name.length > 0,
        `tool should have a non-empty name: ${JSON.stringify(tool)}`);
      assert.ok(tool.inputSchema !== undefined,
        `tool ${tool.name} should have an inputSchema`);
    }
  });

  test("MCP tools/call modifies a file on disk", async () => {
    // Create a temp directory with a JSON file to edit via MCP.
    // The MCP server resolves paths relative to its cwd, so we
    // spawn the server inside the temp directory and use a relative path.
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "patchloom-mcp-call-"));
    await fs.writeFile(path.join(workDir, "config.json"), '{"port": 3000}\n', "utf8");

    const child = execFile(binaryPath, ["mcp-server"], { timeout: 60000, cwd: workDir });
    let stdout = "";
    child.stdout!.on("data", (data: Buffer) => { stdout += data.toString(); });

    // Initialize
    child.stdin!.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: {
        protocolVersion: "2024-11-05", capabilities: {},
        clientInfo: { name: "e2e-test", version: "0.0.1" }
      }
    }) + "\n");

    let deadline = Date.now() + 10000;
    while (!stdout.includes('"id":1') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    child.stdin!.write(JSON.stringify({
      jsonrpc: "2.0", method: "notifications/initialized"
    }) + "\n");

    // Call doc_set to change port from 3000 to 8080 (relative path).
    // MCP param is `selector` (CLI selector path); verified against patchloom 0.15.x.
    child.stdin!.write(JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: {
        name: "doc_set",
        arguments: { path: "config.json", selector: "port", value: 8080 }
      }
    }) + "\n");

    deadline = Date.now() + 10000;
    while (!stdout.includes('"id":3') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    child.kill();

    // Verify the tool call succeeded
    const lines = stdout.trim().split("\n");
    const callLine = lines.find((line) => line.includes('"id":3'));
    assert.ok(callLine, "should have a tools/call response");
    const callResponse = JSON.parse(callLine) as Record<string, unknown>;
    assert.equal(callResponse.jsonrpc, "2.0");
    assert.equal(callResponse.id, 3);
    const callResult = callResponse.result as Record<string, unknown> | undefined;
    assert.ok(callResult,
      `tools/call should return a result (not an error): ${JSON.stringify(callResponse)}`);
    assert.ok(!callResult.isError,
      `tools/call should not be an error: ${JSON.stringify(callResult)}`);

    // Verify the file was actually modified on disk
    const content = JSON.parse(await fs.readFile(path.join(workDir, "config.json"), "utf8")) as Record<string, unknown>;
    assert.equal(content.port, 8080, "doc_set should have changed port to 8080");

    await fs.rm(workDir, { recursive: true, force: true });
  });

  // Cleanup
  test("cleanup managed install temp directory", async () => {
    await fs.rm(installDir, { recursive: true, force: true });
  });
});
