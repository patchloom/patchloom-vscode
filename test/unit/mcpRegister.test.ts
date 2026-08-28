import assert from "node:assert/strict";
import test from "node:test";
import { mcpServerDefinitionsForBinary } from "../../src/mcp/register.js";

test("mcpServerDefinitionsForBinary returns empty when binary is undefined", () => {
  assert.deepEqual(mcpServerDefinitionsForBinary(undefined), []);
});

test("mcpServerDefinitionsForBinary returns one stdio definition for a path", () => {
  const defs = mcpServerDefinitionsForBinary("/opt/patchloom");
  assert.equal(defs.length, 1);
  assert.deepEqual(defs[0], {
    label: "Patchloom MCP",
    command: "/opt/patchloom",
    args: ["mcp-server"]
  });
});
