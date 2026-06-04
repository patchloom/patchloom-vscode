import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as https from "node:https";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import test, { after, before, describe } from "node:test";
import {
  calculateSha256Hex,
  downloadToFile,
  performManagedInstall,
  streamingSha256
} from "../../src/install/managed.js";

let server: https.Server;
let baseUrl: string;
let certDir: string;
let originalTlsReject: string | undefined;

before(async () => {
  certDir = await fs.mkdtemp(path.join(os.tmpdir(), "patchloom-cert-"));
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");
  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 1 -nodes -subj "/CN=localhost" 2>/dev/null`
  );

  const key = await fs.readFile(keyPath, "utf8");
  const cert = await fs.readFile(certPath, "utf8");

  originalTlsReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  server = https.createServer({ key, cert }, (req, res) => {
    if (req.url === "/ok") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end("download-content");
    } else if (req.url === "/error-500") {
      res.writeHead(500, "Internal Server Error");
      res.end();
    } else if (req.url === "/redirect-ok") {
      res.writeHead(302, { Location: `${baseUrl}/ok` });
      res.end();
    } else if (req.url === "/redirect-chain") {
      res.writeHead(302, { Location: `${baseUrl}/redirect-ok` });
      res.end();
    } else if (req.url?.startsWith("/redirect-loop")) {
      res.writeHead(302, { Location: `${baseUrl}/redirect-loop` });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      baseUrl = `https://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (originalTlsReject === undefined) {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsReject;
  }
  await fs.rm(certDir, { recursive: true, force: true });
});

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "patchloom-dl-test-"));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// --- downloadToFile with real defaultDownloadToFile ---

describe("downloadToFile with default HTTPS implementation", () => {
  test("downloads content to the destination file", async () => {
    await withTempDir(async (dir) => {
      const dest = path.join(dir, "output.bin");
      await downloadToFile({ url: `${baseUrl}/ok`, destPath: dest });
      const content = await fs.readFile(dest, "utf8");
      assert.equal(content, "download-content");
    });
  });

  test("follows redirects and delivers final content", async () => {
    await withTempDir(async (dir) => {
      const dest = path.join(dir, "redirected.bin");
      await downloadToFile({ url: `${baseUrl}/redirect-chain`, destPath: dest });
      const content = await fs.readFile(dest, "utf8");
      assert.equal(content, "download-content");
    });
  });

  test("rejects after too many redirects", async () => {
    await withTempDir(async (dir) => {
      const dest = path.join(dir, "loop.bin");
      await assert.rejects(
        () => downloadToFile({ url: `${baseUrl}/redirect-loop`, destPath: dest }),
        /too many redirects/
      );
    });
  });

  test("rejects on HTTP error status", async () => {
    await withTempDir(async (dir) => {
      const dest = path.join(dir, "error.bin");
      await assert.rejects(
        () => downloadToFile({ url: `${baseUrl}/error-500`, destPath: dest }),
        /500/
      );
    });
  });

  test("creates parent directories for the destination", async () => {
    await withTempDir(async (dir) => {
      const dest = path.join(dir, "nested", "subdir", "file.bin");
      await downloadToFile({ url: `${baseUrl}/ok`, destPath: dest });
      const content = await fs.readFile(dest, "utf8");
      assert.equal(content, "download-content");
    });
  });
});

// --- streamingSha256 ---

describe("streamingSha256", () => {
  test("computes the same hash as the in-memory calculateSha256Hex", async () => {
    await withTempDir(async (dir) => {
      const testContent = "hello-streaming-sha256-test";
      const filePath = path.join(dir, "hashme.txt");
      await fs.writeFile(filePath, testContent, "utf8");

      const streamingHash = await streamingSha256(filePath);
      const inMemoryHash = calculateSha256Hex(testContent);
      assert.equal(streamingHash, inMemoryHash);
    });
  });

  test("produces correct SHA-256 for known input", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "known.txt");
      await fs.writeFile(filePath, "abc", "utf8");
      const hash = await streamingSha256(filePath);
      // SHA-256("abc") is a well-known constant
      assert.equal(hash, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    });
  });

  test("handles empty files", async () => {
    await withTempDir(async (dir) => {
      const filePath = path.join(dir, "empty.txt");
      await fs.writeFile(filePath, "", "utf8");
      const hash = await streamingSha256(filePath);
      const expected = calculateSha256Hex("");
      assert.equal(hash, expected);
    });
  });
});

// --- performManagedInstall staging cleanup on failure ---

describe("performManagedInstall staging cleanup", () => {
  test("cleans up staging directory after download failure", async () => {
    await withTempDir(async (installRoot) => {
      let capturedStagingDir: string | undefined;

      await assert.rejects(
        () => performManagedInstall({
          installRoot,
          version: "0.1.0",
          platform: "darwin",
          arch: "arm64",
          downloadFile: async (inputs) => {
            // Capture the staging directory from the dest path
            capturedStagingDir = path.dirname(inputs.destPath);
            await fs.mkdir(capturedStagingDir, { recursive: true });
            // Simulate a partial write then failure
            await fs.writeFile(inputs.destPath, "partial-data", "utf8");
            throw new Error("network error during download");
          },
          failurePersistence: { storageRoot: installRoot }
        }),
        /network error/
      );

      // Verify staging directory was cleaned up
      assert.ok(capturedStagingDir, "should have captured the staging directory");
      try {
        await fs.access(capturedStagingDir);
        assert.fail("staging directory should have been removed after failure");
      } catch (err: any) {
        assert.equal(err.code, "ENOENT", "staging should not exist");
      }
    });
  });
});
