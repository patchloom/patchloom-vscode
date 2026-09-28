import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../../..");

function enginesNode(packageJsonPath: string): string {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    engines?: { node?: string };
  };
  const node = pkg.engines?.node;
  if (typeof node !== "string") {
    throw new Error(`missing engines.node in ${packageJsonPath}`);
  }
  return node;
}

function nodeMajor(enginesNodeSpec: string): number {
  const match = /(\d+)/.exec(enginesNodeSpec);
  assert.ok(match, `cannot parse engines.node major from ${enginesNodeSpec}`);
  return Number(match[1]);
}

test("engines.node major meets installed vsce and ovsx floors", () => {
  const extensionNode = enginesNode(path.join(repoRoot, "package.json"));
  const vsceNode = enginesNode(path.join(repoRoot, "node_modules/@vscode/vsce/package.json"));
  const ovsxNode = enginesNode(path.join(repoRoot, "node_modules/ovsx/package.json"));
  const extensionMajor = nodeMajor(extensionNode);
  assert.ok(
    extensionMajor >= nodeMajor(vsceNode),
    `engines.node ${extensionNode} is below @vscode/vsce ${vsceNode}`
  );
  assert.ok(
    extensionMajor >= nodeMajor(ovsxNode),
    `engines.node ${extensionNode} is below ovsx ${ovsxNode}`
  );
});
