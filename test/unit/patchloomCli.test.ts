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
  assessPatchloomCompatibility,
  resolvePatchloomStatusWithInputs
} from "../../src/binary/patchloom.js";
import { classifyAgentsFile } from "../../src/commands/initializeProject.js";
import { buildStatusDetails, preferredStatusAction } from "../../src/commands/showStatus.js";
import { buildReplaceQuickAction, retargetQuickAction, withApplyFlag } from "../../src/commands/quickActions.js";
import { configureMcpTargets, inspectMcpTargets } from "../../src/mcp/config.js";

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
        "replace", "old_name", "--to", "new_name", txtFile, "--apply"
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
          "replace", "hello", "--to", "goodbye", file, "--check"
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
      // Generate agent rules
      const { stdout: rules } = await execFileAsync(binaryPath, ["agent-rules"], {
        cwd: dir,
        timeout: 10000
      });

      // Write it exactly as generated
      const agentsPath = path.join(dir, "AGENTS.md");
      const content = rules.endsWith("\n") ? rules : `${rules}\n`;
      await fs.writeFile(agentsPath, content, "utf8");

      // Extension's classifier should see it as up_to_date
      const existing = await fs.readFile(agentsPath, "utf8");
      const state = classifyAgentsFile(existing, content);
      assert.equal(state, "up_to_date",
        "freshly written agent-rules output should be classified as up_to_date");
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
