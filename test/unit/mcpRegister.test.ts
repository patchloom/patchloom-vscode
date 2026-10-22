import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpStdioServerDefinition,
  mcpServerDefinitionsForBinary
} from "../../src/mcp/register.js";

class FakeStdio {
  cwd?: { fsPath: string };

  constructor(
    public label: string,
    public command: string,
    public args: string[],
    public env: Record<string, string> = {}
  ) {}
}

test("mcpServerDefinitionsForBinary launches a Windows cmd shim through cmd.exe", () => {
  const defs = mcpServerDefinitionsForBinary(
    "C:\\npm\\patchloom.cmd",
    undefined,
    "full",
    "win32",
    "C:\\Windows\\System32\\cmd.exe"
  );
  assert.equal(defs[0]?.command, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(defs[0]?.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(defs[0]?.args[3], "C:\\npm\\patchloom.cmd mcp-server");
});

test("mcpServerDefinitionsForBinary returns empty when binary is undefined", () => {
  assert.deepEqual(mcpServerDefinitionsForBinary(undefined), []);
});

test("mcpServerDefinitionsForBinary returns one stdio definition for a path", () => {
  const defs = mcpServerDefinitionsForBinary("/opt/patchloom");
  assert.equal(defs.length, 1);
  assert.deepEqual(defs[0], {
    label: "Patchloom MCP",
    command: "/opt/patchloom",
    args: ["mcp-server"],
    env: {}
  });
});

test("mcpServerDefinitionsForBinary follows the core pack setting", () => {
  const defs = mcpServerDefinitionsForBinary("/opt/patchloom", {
    PATCHLOOM_LOG: "debug",
    PATH: "/tmp/evil"
  }, "core");
  assert.deepEqual(defs[0]?.env, {
    PATCHLOOM_LOG: "debug",
    PATCHLOOM_MCP_SURFACE: "core"
  });
  const full = mcpServerDefinitionsForBinary("/opt/patchloom", {
    PATCHLOOM_MCP_SURFACE: "core"
  }, "full");
  assert.deepEqual(full[0]?.env, {});
});

test("mcpServerDefinitionsForBinary includes filtered PATCHLOOM env", () => {
  const defs = mcpServerDefinitionsForBinary("/opt/patchloom", {
    PATCHLOOM_MCP_SURFACE: "core",
    PATH: "/tmp/evil"
  });
  assert.deepEqual(defs[0]?.env, { PATCHLOOM_MCP_SURFACE: "core" });
});

test("createMcpStdioServerDefinition constructs positionally so command is the binary", () => {
  const instance = createMcpStdioServerDefinition(FakeStdio, {
    label: "Patchloom MCP",
    command: "/opt/patchloom",
    args: ["mcp-server"]
  }) as FakeStdio;
  assert.equal(instance.command, "/opt/patchloom");
  assert.equal(instance.label, "Patchloom MCP");
  assert.deepEqual(instance.args, ["mcp-server"]);
  assert.deepEqual(instance.env, {});
});

test("createMcpStdioServerDefinition forwards PATCHLOOM env", () => {
  const instance = createMcpStdioServerDefinition(FakeStdio, {
    label: "Patchloom MCP",
    command: "/opt/patchloom",
    args: ["mcp-server"],
    env: { PATCHLOOM_MCP_SURFACE: "core" }
  }) as FakeStdio;
  assert.equal(instance.env.PATCHLOOM_MCP_SURFACE, "core");
});

test("createMcpStdioServerDefinition assigns workspace cwd after construct", () => {
  const instance = createMcpStdioServerDefinition(
    FakeStdio,
    {
      label: "Patchloom MCP",
      command: "/opt/patchloom",
      args: ["mcp-server"]
    },
    { fsPath: "/workspace/demo" }
  ) as FakeStdio;
  assert.equal(instance.cwd?.fsPath, "/workspace/demo");
});
