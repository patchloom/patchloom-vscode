import assert from "node:assert/strict";
import test from "node:test";
import { refreshAfterPatchloomInputChange } from "../../src/status/refreshAfterInputChange.js";

test("refreshAfterPatchloomInputChange clears inflight before status and MCP refresh", async () => {
  const order: string[] = [];
  await refreshAfterPatchloomInputChange(
    () => {
      order.push("clear");
    },
    async () => {
      order.push("status");
    },
    async () => {
      order.push("mcp");
    }
  );
  assert.deepEqual(order, ["clear", "status", "mcp"]);
});
