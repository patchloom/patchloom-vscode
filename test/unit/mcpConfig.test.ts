import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { parse as parseJsonc } from "jsonc-parser";
import {
  buildPatchloomMcpEntry,
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

test("buildPatchloomMcpEntry omits env for full surface", () => {
  const entry = buildPatchloomMcpEntry("/usr/bin/patchloom");
  assert.equal(entry.command, "/usr/bin/patchloom");
  assert.deepEqual(entry.args, ["mcp-server"]);
  assert.equal(entry.env, undefined);
});

test("buildPatchloomMcpEntry sets PATCHLOOM_MCP_SURFACE for core pack", () => {
  const entry = buildPatchloomMcpEntry("patchloom", "core");
  assert.deepEqual(entry.args, ["mcp-server"]);
  assert.deepEqual(entry.env, { PATCHLOOM_MCP_SURFACE: "core" });
});

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
    assert.equal(entry.env, undefined, "full surface should not inject env");
  });
});

test("configureMcpTargets writes core surface env when requested", async () => {
  await withTempDir(async (workspace) => {
    await configureMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeKinds: ["vscode-workspace"],
      patchloomPathSetting: "patchloom",
      mcpSurface: "core",
      writeFile: async (filePath, content) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      }
    });

    const written = await readJson(path.join(workspace, ".vscode", "mcp.json"));
    const servers = written.servers as Record<string, unknown>;
    const entry = servers.patchloom as Record<string, unknown>;
    assert.deepEqual(entry.env, { PATCHLOOM_MCP_SURFACE: "core" });
  });
});

test("configureMcpTargets preserves sibling servers in JSONC mcp.json", async () => {
  await withTempDir(async (workspace) => {
    const vscodeDir = path.join(workspace, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });
    const filePath = path.join(vscodeDir, "mcp.json");
    await fs.writeFile(
      filePath,
      `{
  // comment
  "servers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    },
  }
}
`,
      "utf8"
    );

    await configureMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeKinds: ["vscode-workspace"],
      patchloomPathSetting: "patchloom",
      readFile: async (targetPath) => {
        try { return await fs.readFile(targetPath, "utf8"); } catch { return undefined; }
      },
      writeFile: async (targetPath, content) => {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, content, "utf8");
      }
    });

    const written = await fs.readFile(filePath, "utf8");
    assert.match(written, /\/\/ comment/);
    const parsed = parseJsonc(written, [], { allowTrailingComma: true }) as Record<string, unknown>;
    const servers = parsed.servers as Record<string, unknown>;
    assert.ok(servers.github, "existing github server should be preserved");
    assert.ok(servers.patchloom, "patchloom server should be added");
  });
});

test("configureMcpTargets leaves a matching JSONC entry untouched", async () => {
  await withTempDir(async (workspace) => {
    const vscodeDir = path.join(workspace, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });
    const filePath = path.join(vscodeDir, "mcp.json");
    const original = `{
  // owner note
  "servers": {
    "patchloom": {
      "args": ["mcp-server"],
      "command": "patchloom"
    }
  }
}
`;
    await fs.writeFile(filePath, original, "utf8");

    const results = await configureMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeKinds: ["vscode-workspace"],
      patchloomPathSetting: "patchloom",
      readFile: async (targetPath) => fs.readFile(targetPath, "utf8"),
      writeFile: async () => {
        throw new Error("matching MCP config must not be rewritten");
      }
    });

    assert.equal(results[0].changed, false);
    assert.equal(await fs.readFile(filePath, "utf8"), original);
  });
});

test("configureMcpTargets refuses a non-object servers value", async () => {
  await withTempDir(async (workspace) => {
    const vscodeDir = path.join(workspace, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });
    const filePath = path.join(vscodeDir, "mcp.json");
    const original = `{ "servers": [] }\n`;
    await fs.writeFile(filePath, original, "utf8");

    await assert.rejects(
      () => configureMcpTargets({
        workspaceFolderPath: workspace,
        homeDir: workspace,
        includeKinds: ["vscode-workspace"],
        patchloomPathSetting: "patchloom",
        readFile: async (targetPath) => fs.readFile(targetPath, "utf8"),
        writeFile: async () => {
          throw new Error("non-object servers value must not be overwritten");
        }
      }),
      /must be a JSON object/
    );
    assert.equal(await fs.readFile(filePath, "utf8"), original);
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

test("configureMcpTargets writes portable .mcp.json with mcpServers and stdio type", async () => {
  await withTempDir(async (workspace) => {
    const filePath = path.join(workspace, ".mcp.json");
    await fs.writeFile(
      filePath,
      `${JSON.stringify({ mcpServers: { other: { command: "other-server" } } }, null, 2)}\n`,
      "utf8"
    );
    const readFile = async (targetPath: string) => {
      try { return await fs.readFile(targetPath, "utf8"); } catch { return undefined; }
    };
    const writeFile = async (targetPath: string, content: string) => {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, "utf8");
    };
    const inputs = {
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeKinds: ["portable-workspace"] as const,
      patchloomPathSetting: "/opt/patchloom",
      mcpSurface: "core" as const,
      readFile,
      writeFile
    };

    const first = await configureMcpTargets(inputs);
    assert.equal(first.length, 1);
    assert.equal(first[0].changed, true);
    assert.equal(first[0].filePath, filePath);

    const written = await readJson(filePath);
    assert.equal(written.servers, undefined);
    const servers = written.mcpServers as Record<string, Record<string, unknown>>;
    assert.equal(servers.other.command, "other-server");
    assert.deepEqual(servers.patchloom, {
      type: "stdio",
      command: "/opt/patchloom",
      args: ["mcp-server"],
      env: { PATCHLOOM_MCP_SURFACE: "core" }
    });
    await assert.rejects(() => fs.stat(path.join(workspace, ".vscode", "mcp.json")));

    const second = await configureMcpTargets(inputs);
    assert.equal(second[0].changed, false);

    const inspected = await inspectMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      readFile
    });
    const portable = inspected.find((target) => target.kind === "portable-workspace");
    const vscodeTarget = inspected.find((target) => target.kind === "vscode-workspace");
    assert.equal(portable?.configured, true);
    assert.equal(vscodeTarget?.configured, false);
  });
});

test("configureMcpTargets refuses a config symlink that leaves the workspace", async (t) => {
  await withTempDir(async (workspace) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "patchloom-mcp-outside-"));
    try {
      const secret = path.join(outside, "secret.txt");
      await fs.writeFile(secret, "do-not-touch", "utf8");
      const linkPath = path.join(workspace, ".mcp.json");
      try {
        await fs.symlink(secret, linkPath);
      } catch {
        t.skip("fs.symlink is not available on this platform");
        return;
      }

      let reads = 0;
      const inspected = await inspectMcpTargets({
        workspaceFolderPath: workspace,
        homeDir: workspace,
        includeUserTarget: false,
        readFile: async (filePath) => {
          if (filePath === linkPath) {
            reads += 1;
          }
          return undefined;
        }
      });
      assert.equal(reads, 0);
      assert.equal(
        inspected.find((target) => target.kind === "portable-workspace")?.configured,
        false
      );

      let writes = 0;
      await assert.rejects(
        () => configureMcpTargets({
          workspaceFolderPath: workspace,
          homeDir: workspace,
          includeKinds: ["portable-workspace"],
          patchloomPathSetting: "patchloom",
          writeFile: async () => {
            writes += 1;
          }
        }),
        /resolves outside/
      );
      assert.equal(writes, 0);
      assert.equal(await fs.readFile(secret, "utf8"), "do-not-touch");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

test("configureMcpTargets writes Cursor config with mcpServers key", async () => {
  await withTempDir(async (workspace) => {
    await configureMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeKinds: ["cursor-workspace"],
      patchloomPathSetting: "patchloom",
      writeFile: async (filePath, content) => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf8");
      }
    });

    const written = await readJson(path.join(workspace, ".cursor", "mcp.json"));
    assert.equal(written.servers, undefined, "Cursor does not read the VS Code servers key");
    const servers = written.mcpServers as Record<string, unknown>;
    assert.ok(servers.patchloom);
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
    assert.ok((cursorConfig.mcpServers as Record<string, unknown>).patchloom);
  });
});

test("inspectMcpTargets does not treat Cursor servers-only file as configured", async () => {
  await withTempDir(async (workspace) => {
    const cursorDir = path.join(workspace, ".cursor");
    await fs.mkdir(cursorDir, { recursive: true });
    await fs.writeFile(
      path.join(cursorDir, "mcp.json"),
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

    const cursorTarget = targets.find((t) => t.kind === "cursor-workspace");
    assert.ok(cursorTarget);
    assert.equal(cursorTarget.exists, true);
    assert.equal(cursorTarget.configured, false, "Cursor only loads mcpServers");
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

test("configureMcpTargets refuses garbage JSON and leaves the file unchanged", async () => {
  await withTempDir(async (workspace) => {
    const vscodeDir = path.join(workspace, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });
    const filePath = path.join(vscodeDir, "mcp.json");
    const original = "not json {{{";
    await fs.writeFile(filePath, original, "utf8");

    let wrote = false;
    await assert.rejects(
      () => configureMcpTargets({
        workspaceFolderPath: workspace,
        homeDir: workspace,
        includeKinds: ["vscode-workspace"],
        patchloomPathSetting: "patchloom",
        readFile: async (targetPath) => {
          try { return await fs.readFile(targetPath, "utf8"); } catch { return undefined; }
        },
        writeFile: async (targetPath, content) => {
          wrote = true;
          await fs.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.writeFile(targetPath, content, "utf8");
        }
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /mcp\.json/);
        return true;
      }
    );

    assert.equal(wrote, false, "garbage config must not be overwritten");
    const after = await fs.readFile(filePath, "utf8");
    assert.equal(after, original);
  });
});

test("inspectMcpTargets reports unconfigured when existing file is not valid JSONC", async () => {
  await withTempDir(async (workspace) => {
    const vscodeDir = path.join(workspace, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });
    await fs.writeFile(path.join(vscodeDir, "mcp.json"), "not json {{{", "utf8");

    const targets = await inspectMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      readFile: async (targetPath) => {
        try { return await fs.readFile(targetPath, "utf8"); } catch { return undefined; }
      }
    });

    const vscodeTarget = targets.find((t) => t.kind === "vscode-workspace");
    assert.ok(vscodeTarget);
    assert.equal(vscodeTarget.exists, true);
    assert.equal(vscodeTarget.configured, false);
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

test("configureMcpTargets does not replace a config it could not read", async () => {
  await withTempDir(async (workspace) => {
    const vscodeDir = path.join(workspace, ".vscode");
    const filePath = path.join(vscodeDir, "mcp.json");
    await fs.mkdir(filePath, { recursive: true });

    let writes = 0;
    await assert.rejects(
      () => configureMcpTargets({
        workspaceFolderPath: workspace,
        homeDir: workspace,
        includeKinds: ["vscode-workspace"],
        patchloomPathSetting: "patchloom",
        writeFile: async () => {
          writes += 1;
        }
      }),
      (err: unknown) => {
        assert.equal(isEnoent(err), false);
        return true;
      }
    );
    assert.equal(writes, 0);

    const inspected = await inspectMcpTargets({
      workspaceFolderPath: workspace,
      homeDir: workspace,
      includeUserTarget: false
    });
    const vscodeTarget = inspected.find((target) => target.kind === "vscode-workspace");
    assert.ok(vscodeTarget);
    assert.equal(vscodeTarget.configured, false);
  });
});

test("configureMcpTargets leaves an unreadable config file unchanged", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    t.skip("chmod 0 does not deny read for this process");
    return;
  }

  await withTempDir(async (workspace) => {
    const vscodeDir = path.join(workspace, ".vscode");
    await fs.mkdir(vscodeDir, { recursive: true });
    const filePath = path.join(vscodeDir, "mcp.json");
    const original = `${JSON.stringify({
      servers: { other: { command: "other-server" } }
    }, null, 2)}\n`;
    await fs.writeFile(filePath, original, "utf8");
    await fs.chmod(filePath, 0);

    let writes = 0;
    try {
      await assert.rejects(
        () => configureMcpTargets({
          workspaceFolderPath: workspace,
          homeDir: workspace,
          includeKinds: ["vscode-workspace"],
          patchloomPathSetting: "patchloom",
          writeFile: async () => {
            writes += 1;
          }
        }),
        (err: unknown) => {
          assert.equal(isEnoent(err), false);
          return true;
        }
      );
      assert.equal(writes, 0);
    } finally {
      await fs.chmod(filePath, 0o644);
    }

    const after = await fs.readFile(filePath, "utf8");
    assert.equal(after, original);
  });
});

function isEnoent(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}
