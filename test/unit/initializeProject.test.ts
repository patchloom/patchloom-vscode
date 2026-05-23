import assert from "node:assert/strict";
import test from "node:test";
import { classifyAgentsFile } from "../../src/commands/initializeProject";
import { buildStatusDetails, preferredStatusAction } from "../../src/commands/showStatus";

test("classifyAgentsFile returns missing when AGENTS.md does not exist", () => {
  assert.equal(classifyAgentsFile(undefined, "# Rules\n"), "missing");
});

test("classifyAgentsFile treats CRLF and trailing newline differences as up to date", () => {
  assert.equal(classifyAgentsFile("# Rules\r\n- One\r\n", "# Rules\n- One\n\n"), "up_to_date");
});

test("classifyAgentsFile detects real content drift", () => {
  assert.equal(classifyAgentsFile("# Rules\n- One\n", "# Rules\n- Two\n"), "different");
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
      hasAgentsFile: false
    }
  );

  assert.match(details, /Patchloom is ready\./);
  assert.match(details, /Source: PATH/);
  assert.match(details, /Workspace: demo/);
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
      hasAgentsFile: false
    }
  );

  assert.deepEqual(action, {
    title: "Open Settings",
    command: "patchloom.openPatchloomSettings"
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
      hasAgentsFile: false
    }
  );

  assert.deepEqual(action, {
    title: "Initialize Project",
    command: "patchloom.initializeProject"
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
      hasAgentsFile: true
    }
  );

  assert.equal(action, undefined);
});
