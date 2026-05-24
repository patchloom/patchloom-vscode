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
} from "../../src/binary/patchloom";

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
});
