import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  assessPatchloomCompatibility,
  comparePatchloomVersions,
  findOnPath,
  parsePatchloomVersion,
  resolvePatchloomStatusWithInputs
} from "../../src/binary/patchloom";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "patchloom-discovery-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("findOnPath discovers a real executable in a temp directory", async () => {
  await withTempDir(async (dir) => {
    const fakeBinary = path.join(dir, "patchloom");
    await fs.writeFile(fakeBinary, "#!/bin/sh\necho patchloom 0.1.0\n", { mode: 0o755 });

    const found = await findOnPath(dir, "linux");
    assert.equal(found, fakeBinary);
  });
});

test("findOnPath skips non-executable files", async () => {
  await withTempDir(async (dir) => {
    const fakeBinary = path.join(dir, "patchloom");
    await fs.writeFile(fakeBinary, "#!/bin/sh\necho patchloom 0.1.0\n", { mode: 0o644 });

    const found = await findOnPath(dir, "linux");
    assert.equal(found, undefined);
  });
});

test("findOnPath searches multiple PATH directories in order", async () => {
  await withTempDir(async (parent) => {
    const firstDir = path.join(parent, "first");
    const secondDir = path.join(parent, "second");
    await fs.mkdir(firstDir);
    await fs.mkdir(secondDir);

    await fs.writeFile(path.join(firstDir, "patchloom"), "#!/bin/sh\necho first\n", { mode: 0o755 });
    await fs.writeFile(path.join(secondDir, "patchloom"), "#!/bin/sh\necho second\n", { mode: 0o755 });

    const found = await findOnPath(`${firstDir}:${secondDir}`, "linux");
    assert.equal(found, path.join(firstDir, "patchloom"), "should find the first match in PATH order");
  });
});

test("findOnPath returns undefined for empty PATH", async () => {
  const found = await findOnPath("", "linux");
  assert.equal(found, undefined);
});

test("findOnPath deduplicates PATH entries", async () => {
  await withTempDir(async (dir) => {
    const fakeBinary = path.join(dir, "patchloom");
    await fs.writeFile(fakeBinary, "#!/bin/sh\necho v1\n", { mode: 0o755 });
    let checkCount = 0;

    const found = await findOnPath(`${dir}:${dir}:${dir}`, "linux", async (candidate) => {
      checkCount++;
      try {
        await fs.access(candidate, fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });

    assert.equal(found, fakeBinary);
    assert.equal(checkCount, 1, "should only check each directory once");
  });
});

test("resolvePatchloomStatusWithInputs discovers a real executable via PATH", async () => {
  await withTempDir(async (dir) => {
    const fakeBinary = path.join(dir, "patchloom");
    await fs.writeFile(fakeBinary, "#!/bin/sh\necho patchloom 0.1.0\n", { mode: 0o755 });

    const status = await resolvePatchloomStatusWithInputs({
      configuredPath: "",
      pathValue: dir,
      canExecute: async (candidate) => {
        try {
          await fs.access(candidate, fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      },
      getVersion: async () => "patchloom 0.1.0"
    });

    assert.equal(status.ready, true);
    assert.equal(status.source, "path");
    assert.equal(status.binaryPath, fakeBinary);
    assert.equal(status.version, "patchloom 0.1.0");
  });
});

test("resolvePatchloomStatusWithInputs reports configured path that does not exist", async () => {
  await withTempDir(async (dir) => {
    const nonexistent = path.join(dir, "no-such-binary");

    const status = await resolvePatchloomStatusWithInputs({
      configuredPath: nonexistent,
      pathValue: "",
      canExecute: async (candidate) => {
        try {
          await fs.access(candidate, fs.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      },
      getVersion: async () => undefined
    });

    assert.equal(status.ready, false);
    assert.equal(status.source, "setting");
    assert.match(status.message, /not executable/);
  });
});

test("parsePatchloomVersion handles edge cases", () => {
  assert.equal(parsePatchloomVersion(undefined), undefined);
  assert.equal(parsePatchloomVersion(""), undefined);
  assert.equal(parsePatchloomVersion("0.1.0"), "0.1.0");
  assert.equal(parsePatchloomVersion("patchloom v1.2.3+build.42"), "1.2.3+build.42");
  assert.equal(parsePatchloomVersion("no version here"), undefined);
});

test("comparePatchloomVersions handles major, minor, and patch differences", () => {
  assert.ok(comparePatchloomVersions("1.0.0", "0.9.9") > 0);
  assert.ok(comparePatchloomVersions("0.1.0", "0.0.99") > 0);
  assert.ok(comparePatchloomVersions("0.0.1", "0.0.0") > 0);
  assert.ok(comparePatchloomVersions("0.0.0", "0.0.1") < 0);
  assert.equal(comparePatchloomVersions("1.2.3", "1.2.3"), 0);
});

test("assessPatchloomCompatibility correctly identifies supported versions", () => {
  const supported = assessPatchloomCompatibility("patchloom 0.1.0");
  assert.equal(supported.compatibility, "supported");
  assert.equal(supported.detectedVersion, "0.1.0");

  const newer = assessPatchloomCompatibility("patchloom 1.0.0");
  assert.equal(newer.compatibility, "supported");

  const noVersion = assessPatchloomCompatibility("some unknown output");
  assert.equal(noVersion.compatibility, "unknown");
});
