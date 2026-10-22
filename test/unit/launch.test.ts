import assert from "node:assert/strict";
import test from "node:test";
import { execPatchloomFile, patchloomLaunch } from "../../src/binary/launch.js";

test("patchloomLaunch runs exe and unix binaries directly", () => {
  const exe = patchloomLaunch("C:\\tools\\patchloom.exe", ["--version"], "win32", "C:\\Windows\\System32\\cmd.exe");
  assert.equal(exe.file, "C:\\tools\\patchloom.exe");
  assert.deepEqual(exe.args, ["--version"]);
  assert.equal(exe.shell, false);
  assert.equal(exe.windowsVerbatimArguments, false);

  const unix = patchloomLaunch("/usr/local/bin/patchloom", ["mcp-server"], "darwin");
  assert.equal(unix.file, "/usr/local/bin/patchloom");
  assert.deepEqual(unix.args, ["mcp-server"]);
  assert.equal(unix.shell, false);
});

test("patchloomLaunch runs cmd and bat shims through ComSpec without shell", () => {
  for (const name of ["patchloom.cmd", "patchloom.CMD", "patchloom.bat"]) {
    const launch = patchloomLaunch(`C:\\npm\\${name}`, ["--version"], "win32", "C:\\Windows\\System32\\cmd.exe");
    assert.equal(launch.file, "C:\\Windows\\System32\\cmd.exe");
    assert.equal(launch.shell, false);
    assert.equal(launch.windowsVerbatimArguments, true);
    assert.deepEqual(launch.args.slice(0, 3), ["/d", "/s", "/c"]);
    assert.match(launch.args[3] ?? "", /patchloom\.(cmd|bat)/i);
    assert.match(launch.args[3] ?? "", /--version/);
  }

  const fallback = patchloomLaunch("C:\\npm\\patchloom.cmd", ["mcp-server"], "win32", "  ");
  assert.equal(fallback.file, "cmd.exe");
  assert.equal(fallback.shell, false);

  const spaced = patchloomLaunch(
    "C:\\Users\\Ada Lovelace\\npm\\patchloom.cmd",
    ["--version"],
    "win32",
    "C:\\Windows\\System32\\cmd.exe"
  );
  assert.equal(spaced.args[3]?.startsWith("\""), true);
  assert.equal(spaced.args[3]?.endsWith("\""), true);
  const inner = spaced.args[3]?.slice(1, -1) ?? "";
  assert.match(inner, /^"C:\\Users\\Ada Lovelace\\npm\\patchloom.cmd"/);

  const percent = patchloomLaunch("C:\\npm\\patchloom.cmd", ["--new=%PATH%"], "win32", "cmd.exe");
  assert.match(percent.args[3] ?? "", /%%PATH%%/);
  assert.throws(
    () => patchloomLaunch("C:\\npm\\patchloom.cmd", ["a\nb"], "win32", "cmd.exe"),
    /newline/
  );

  const bare = patchloomLaunch("patchloom", ["mcp-server"], "win32", "cmd.exe");
  assert.equal(bare.file, "cmd.exe");
  assert.equal(bare.shell, false);
  assert.deepEqual(bare.args.slice(0, 3), ["/d", "/s", "/c"]);

  const hostQuoted = patchloomLaunch(
    "C:\\Users\\Ada Lovelace\\npm\\patchloom.cmd",
    ["mcp-server"],
    "win32",
    "cmd.exe",
    false
  );
  assert.equal(hostQuoted.windowsVerbatimArguments, false);
  assert.equal(
    hostQuoted.args[3],
    "\"C:\\Users\\Ada Lovelace\\npm\\patchloom.cmd\" mcp-server"
  );
});

test("execPatchloomFile runs a direct binary and keeps stdout text", async () => {
  const result = await execPatchloomFile(process.execPath, ["-e", "process.stdout.write('ok')"], {
    timeout: 5_000,
    windowsHide: true
  });
  assert.equal(result.stdout, "ok");
  assert.equal(result.stderr, "");
});
