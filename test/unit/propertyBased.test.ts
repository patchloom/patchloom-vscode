import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fc from "fast-check";

import { parsePatchloomVersion, comparePatchloomVersions } from "../../src/binary/patchloom.js";
import { formatError, formatCliOutput } from "../../src/util.js";
import { parseManagedInstallChecksumFile } from "../../src/install/managed.js";

describe("parsePatchloomVersion property-based tests", () => {
  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const result = parsePatchloomVersion(input);
        assert.ok(result === undefined || typeof result === "string");
      })
    );
  });

  it("always extracts the version from a well-formed semver string", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        (major, minor, patch) => {
          const version = `${major}.${minor}.${patch}`;
          const result = parsePatchloomVersion(`patchloom ${version} (abc123)`);
          assert.equal(result, version);
        }
      )
    );
  });

  it("strips the leading v prefix from parsed versions", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        (major, minor, patch) => {
          const version = `v${major}.${minor}.${patch}`;
          const result = parsePatchloomVersion(version);
          assert.ok(result !== undefined && !result.startsWith("v"));
        }
      )
    );
  });
});

describe("comparePatchloomVersions property-based tests", () => {
  it("is reflexive: compare(a, a) === 0", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        (major, minor, patch) => {
          const v = `${major}.${minor}.${patch}`;
          assert.equal(comparePatchloomVersions(v, v), 0);
        }
      )
    );
  });

  it("is antisymmetric: sign(compare(a, b)) === -sign(compare(b, a))", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        (ma, mi, pa, mb, mib, pb) => {
          const a = `${ma}.${mi}.${pa}`;
          const b = `${mb}.${mib}.${pb}`;
          const cmp = comparePatchloomVersions(a, b);
          const rev = comparePatchloomVersions(b, a);
          assert.equal(Math.sign(cmp), -Math.sign(rev));
        }
      )
    );
  });

  it("respects numeric ordering for major versions", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 998 }),
        fc.nat({ max: 999 }),
        fc.nat({ max: 999 }),
        (major, minor, patch) => {
          const a = `${major}.${minor}.${patch}`;
          const b = `${major + 1}.${minor}.${patch}`;
          assert.ok(comparePatchloomVersions(a, b) < 0);
        }
      )
    );
  });
});

describe("formatError property-based tests", () => {
  it("never throws on arbitrary input", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        const result = formatError(input);
        assert.equal(typeof result, "string");
      })
    );
  });

  it("returns the message for Error instances with non-empty messages", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        (msg) => {
          assert.equal(formatError(new Error(msg)), msg);
        }
      )
    );
  });
});

describe("formatCliOutput property-based tests", () => {
  it("always returns a non-empty string", () => {
    fc.assert(
      fc.property(fc.integer(), fc.string(), fc.string(), (exitCode, stdout, stderr) => {
        const result = formatCliOutput({ exitCode, stdout, stderr });
        assert.ok(result.length > 0);
      })
    );
  });

  it("includes exit code when both streams are whitespace-only", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 255 }), (exitCode) => {
        const result = formatCliOutput({ exitCode, stdout: "  ", stderr: "\n" });
        assert.ok(result.includes(`exit code ${exitCode}`));
      })
    );
  });
});

describe("parseManagedInstallChecksumFile property-based tests", () => {
  it("returns an array or throws a verification error on arbitrary input", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        try {
          const result = parseManagedInstallChecksumFile(input);
          assert.ok(Array.isArray(result));
        } catch (error: unknown) {
          assert.ok(error instanceof Error);
          assert.ok("reason" in error, "thrown error should have a reason field");
        }
      })
    );
  });

  it("parses well-formed checksum lines into entries", () => {
    const hexChar = fc.mapToConstant(
      { num: 10, build: (v) => String.fromCharCode(48 + v) },
      { num: 6, build: (v) => String.fromCharCode(97 + v) }
    );
    const hex64 = fc.string({ unit: hexChar, minLength: 64, maxLength: 64 });
    fc.assert(
      fc.property(
        hex64,
        fc.stringMatching(/^[a-z][a-z0-9._-]{0,39}$/),
        (hash, filename) => {
          const content = `${hash}  ${filename}`;
          const entries = parseManagedInstallChecksumFile(content);
          assert.ok(entries.length >= 1);
          assert.equal(entries[0].sha256, hash);
          assert.equal(entries[0].fileName, filename);
        }
      )
    );
  });

  it("returns empty array for blank input", () => {
    const whitespaceChar = fc.constantFrom(" ", "\t", "\n", "\r");
    fc.assert(
      fc.property(
        fc.string({ unit: whitespaceChar, minLength: 0, maxLength: 50 }),
        (whitespace) => {
          const result = parseManagedInstallChecksumFile(whitespace);
          assert.equal(result.length, 0);
        }
      )
    );
  });
});
