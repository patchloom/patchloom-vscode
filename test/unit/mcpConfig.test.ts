import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  configureMcpTargets,
  inspectMcpTargets,
  resolveMcpTargets
} from "../../src/mcp/config.js";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "patchloom-mcp-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}

test("configureMcpTargets writes VS Code mcp.json to a real temp workspace", async () => {
  await withTempDir(async (workspace) => {
    const results = await configureMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeKinds: ["vscode-workspace"],
      patchloomPathSetting: "/usr/local/bin/patchloom",
      writeFile: async (filePath, content) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      }
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].kind, "vscode-workspace");
    assert.equal(results[0].changed, true);

    const written = await readJson(path.join(workspace, ".vscode", "mcp.json"));
    const servers = written.servers as Record<string, unknown>;
    assert.ok(servers.patchloom);
    const entry = servers.patchloom as Record<string, unknown>;
    assert.equal(entry.command, "/usr/local/bin/patchloom");
    assert.deepEqual(entry.args, ["mcp-server"]);
  });
});

test("configureMcpTargets preserves existing servers in the config file", async () => {
  await withTempDir(async (workspace) => {
    const vscodeDir = path.join(workspace, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });
    await fs.writeFile(
      path.join(vscodeDir, "mcp.json"),
      JSON.stringify({ servers: { other: { command: "other-tool", args: ["serve"] } } }),
      "utf8"
    );

    await configureMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeKinds: ["vscode-workspace"],
      patchloomPathSetting: "patchloom",
      readFile: async (filePath) => {
        try { return await fs.readFile(filePath, "utf8"); } catch { return undefined; }
      },
      writeFile: async (filePath, content) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      }
    });

    const written = await readJson(path.join(vscodeDir, "mcp.json"));
    const servers = written.servers as Record<string, unknown>;
    assert.ok(servers.other, "existing 'other' server should be preserved");
    assert.ok(servers.patchloom, "patchloom server should be added");
  });
});

test("configureMcpTargets creates both vscode and cursor configs", async () => {
  await withTempDir(async (workspace) => {
    const results = await configureMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeKinds: ["vscode-workspace", "cursor-workspace"],
      patchloomPathSetting: "patchloom",
      writeFile: async (filePath, content) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      }
    });

    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.changed));

    const vscodeConfig = await readJson(path.join(workspace, ".vscode", "mcp.json"));
    const cursorConfig = await readJson(path.join(workspace, ".cursor", "mcp.json"));
    assert.ok((vscodeConfig.servers as Record<string, unknown>).patchloom);
    assert.ok((cursorConfig.servers as Record<string, unknown>).patchloom);
  });
});

test("inspectMcpTargets reads configured status from real files", async () => {
  await withTempDir(async (workspace) => {
    const vscodeDir = path.join(workspace, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });
    await fs.writeFile(
      path.join(vscodeDir, "mcp.json"),
      JSON.stringify({ servers: { patchloom: { command: "patchloom", args: ["mcp-server"] } } }),
      "utf8"
    );

    const targets = await inspectMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      readFile: async (filePath) => {
        try { return await fs.readFile(filePath, "utf8"); } catch { return undefined; }
      }
    });

    const vscodeTarget = targets.find((t) => t.kind === "vscode-workspace");
    assert.ok(vscodeTarget);
    assert.equal(vscodeTarget.exists, true);
    assert.equal(vscodeTarget.configured, true);

    const cursorTarget = targets.find((t) => t.kind === "cursor-workspace");
    assert.ok(cursorTarget);
    assert.equal(cursorTarget.exists, false);
    assert.equal(cursorTarget.configured, false);
  });
});

test("configureMcpTargets is idempotent on second call", async () => {
  await withTempDir(async (workspace) => {
    const readFile = async (filePath: string) => {
      try { return await fs.readFile(filePath, "utf8"); } catch { return undefined; }
    };
    const writeFile = async (filePath: string, content: string) => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    };
    const inputs = {
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeKinds: ["vscode-workspace"] as const,
      patchloomPathSetting: "patchloom",
      readFile,
      writeFile
    };

    const first = await configureMcpTargets(inputs);
    assert.equal(first[0].changed, true);

    const second = await configureMcpTargets(inputs);
    assert.equal(second[0].changed, false);
  });
});

test("configureMcpTargets handles invalid JSON in existing file gracefully", async () => {
  await withTempDir(async (workspace) => {
    const vscodeDir = path.join(workspace, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });
    await fs.writeFile(path.join(vscodeDir, "mcp.json"), "not json {{{", "utf8");

    const results = await configureMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeKinds: ["vscode-workspace"],
      patchloomPathSetting: "patchloom",
      readFile: async (filePath) => {
        try { return await fs.readFile(filePath, "utf8"); } catch { return undefined; }
      },
      writeFile: async (filePath, content) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      }
    });

    assert.equal(results[0].changed, true);
    const written = await readJson(path.join(vscodeDir, "mcp.json"));
    assert.ok((written.servers as Record<string, unknown>).patchloom);
  });
});

test("configureMcpTargets writes windsurf config with mcpServers key", async () => {
  await withTempDir(async (homeDir) => {
    const results = await configureMcpTargets({
      homeDir,
      includeKinds: ["windsurf-user"],
      includeUserTarget: true,
      patchloomPathSetting: "patchloom",
      writeFile: async (filePath, content) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      }
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].kind, "windsurf-user");
    assert.equal(results[0].changed, true);

    const written = await readJson(path.join(homeDir, ".codeium", "windsurf", "mcp_config.json"));
    assert.ok(written.mcpServers, "windsurf config should use mcpServers key");
    const servers = written.mcpServers as Record<string, unknown>;
    assert.ok(servers.patchloom);
  });
});

test("resolveMcpTargets omits workspace targets when no workspace is provided", () => {
  const targets = resolveMcpTargets(undefined, "/Users/demo", true);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].kind, "windsurf-user");
});

test("configureMcpTargets handles empty config file", async () => {
  await withTempDir(async (workspace) => {
    const vscodeDir = path.join(workspace, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });
    await fs.writeFile(path.join(vscodeDir, "mcp.json"), "", "utf8");

    const results = await configureMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeKinds: ["vscode-workspace"],
      patchloomPathSetting: "patchloom",
      readFile: async (filePath) => {
        try { return await fs.readFile(filePath, "utf8"); } catch { return undefined; }
      },
      writeFile: async (filePath, content) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      }
    });

    assert.equal(results[0].changed, true);
    const written = await readJson(path.join(vscodeDir, "mcp.json"));
    assert.ok((written.servers as Record<string, unknown>).patchloom);
  });
});
