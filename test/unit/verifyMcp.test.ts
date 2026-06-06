import assert from "node:assert/strict";
import test from "node:test";
import { parseInitializeResponse, verifyMcpServer } from "../../src/commands/verifyMcp.js";
import { buildStatusDetails } from "../../src/status/details.js";

// --- parseInitializeResponse ---

test("parseInitializeResponse extracts server info from valid response", () => {
  const data = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "patchloom", version: "0.2.0" },
      capabilities: { tools: {} }
    }
  });

  const result = parseInitializeResponse(data);
  assert.ok(result);
  assert.equal(result.ok, true);
  assert.equal(result.serverName, "patchloom");
  assert.equal(result.serverVersion, "0.2.0");
  assert.match(result.message, /patchloom/);
  assert.match(result.message, /0\.2\.0/);
});

test("parseInitializeResponse handles response without serverInfo", () => {
  const data = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: {}
    }
  });

  const result = parseInitializeResponse(data);
  assert.ok(result);
  assert.equal(result.ok, true);
  assert.equal(result.serverName, undefined);
  assert.match(result.message, /responded successfully/);
});

test("parseInitializeResponse detects JSON-RPC error response", () => {
  const data = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32600, message: "Invalid Request" }
  });

  const result = parseInitializeResponse(data);
  assert.ok(result);
  assert.equal(result.ok, false);
  assert.match(result.message, /Invalid Request/);
});

test("parseInitializeResponse returns undefined for empty string", () => {
  assert.equal(parseInitializeResponse(""), undefined);
});

test("parseInitializeResponse returns undefined for non-JSON lines", () => {
  assert.equal(parseInitializeResponse("not json\nalso not json\n"), undefined);
});

test("parseInitializeResponse skips non-jsonrpc lines", () => {
  const data = '{"status":"ok"}\n' + JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { protocolVersion: "2024-11-05", capabilities: {} }
  });

  const result = parseInitializeResponse(data);
  assert.ok(result);
  assert.equal(result.ok, true);
});

test("parseInitializeResponse handles multi-line output with blank lines", () => {
  const data = "\n\n" + JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2024-11-05",
      serverInfo: { name: "patchloom", version: "0.1.0" },
      capabilities: {}
    }
  }) + "\n";

  const result = parseInitializeResponse(data);
  assert.ok(result);
  assert.equal(result.ok, true);
  assert.equal(result.serverName, "patchloom");
});

// --- verifyMcpServer with injected spawnProcess ---

test("verifyMcpServer returns success from injected spawn", async () => {
  const result = await verifyMcpServer({
    binaryPath: "/usr/local/bin/patchloom",
    spawnProcess: async () => ({
      ok: true,
      serverName: "patchloom",
      serverVersion: "0.2.0",
      message: "MCP server verified: patchloom 0.2.0"
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.serverName, "patchloom");
});

test("verifyMcpServer returns failure from injected spawn", async () => {
  const result = await verifyMcpServer({
    binaryPath: "/usr/local/bin/patchloom",
    spawnProcess: async () => ({
      ok: false,
      message: "MCP server exited with code 1. binary not found"
    })
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /exited with code 1/);
});

test("verifyMcpServer catches thrown errors from spawn", async () => {
  const result = await verifyMcpServer({
    binaryPath: "/nonexistent/patchloom",
    spawnProcess: async () => {
      throw new Error("ENOENT: spawn failed");
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /ENOENT/);
});

test("verifyMcpServer catches non-Error thrown values", async () => {
  const result = await verifyMcpServer({
    binaryPath: "/nonexistent/patchloom",
    spawnProcess: async () => {
      throw "string error";
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /string error/);
});

// --- buildStatusDetails with per-editor MCP targets ---

test("buildStatusDetails shows per-editor MCP breakdown", () => {
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
      hasAgentsFile: true,
      hasMcpConfig: true,
      mcpTargets: [
        { kind: "vscode-workspace", label: "VS Code workspace", filePath: "/demo/.vscode/mcp.json", exists: true, configured: true },
        { kind: "cursor-workspace", label: "Cursor workspace", filePath: "/demo/.cursor/mcp.json", exists: false, configured: false },
        { kind: "windsurf-user", label: "Windsurf user", filePath: "/home/.codeium/windsurf/mcp_config.json", exists: false, configured: false }
      ],
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    }
  );

  assert.match(details, /VS Code workspace.*configured/);
  assert.match(details, /Cursor workspace.*not configured/);
  assert.match(details, /Windsurf user.*not configured/);
});

test("buildStatusDetails shows fallback when mcpTargets is undefined", () => {
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
      hasAgentsFile: true,
      hasMcpConfig: true,
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    }
  );

  assert.match(details, /MCP config: no targets available/);
});

test("buildStatusDetails shows checkmark for configured targets", () => {
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
      hasAgentsFile: true,
      hasMcpConfig: true,
      mcpTargets: [
        { kind: "vscode-workspace", label: "VS Code workspace", filePath: "/demo/.vscode/mcp.json", exists: true, configured: true }
      ],
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    }
  );

  assert.match(details, /\u2713/);
  assert.match(details, /configured/);
});

test("buildStatusDetails shows X for unconfigured targets", () => {
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
      hasAgentsFile: true,
      hasMcpConfig: false,
      mcpTargets: [
        { kind: "cursor-workspace", label: "Cursor workspace", filePath: "/demo/.cursor/mcp.json", exists: false, configured: false }
      ],
      workspaceCount: 1,
      environmentLabel: "Local",
      environmentSupport: "supported"
    }
  );

  assert.match(details, /\u2717/);
  assert.match(details, /not configured/);
});
