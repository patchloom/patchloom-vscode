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
