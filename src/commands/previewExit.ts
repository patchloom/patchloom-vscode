/**
 * Preview without `--apply` exits 2 when it would write (`ok: true`,
 * `applied: false`). Patch apply and merge omit `status`, so that field
 * is not required. Call this only on the dry run. `--apply` succeeds on exit 0.
 */
export function previewDryRunMayContinue(result: {
  readonly exitCode: number;
  readonly stdout: string;
}): boolean {
  if (result.exitCode === 0) {
    return true;
  }
  if (result.exitCode !== 2) {
    return false;
  }
  const report = parsePreviewObject(result.stdout);
  return report !== undefined && report.ok === true && report.applied !== true;
}

function parsePreviewObject(stdout: string): { ok?: unknown; applied?: unknown } | undefined {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") {
      return undefined;
    }
    return parsed as { ok?: unknown; applied?: unknown };
  } catch {
    return undefined;
  }
}
