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

function samePreviewText(left: string, right: string): boolean {
  return left.replace(/\r\n/g, "\n") === right.replace(/\r\n/g, "\n");
}

/** The preview was built from one snapshot. A dirty buffer or a later disk edit is a different file. */
export function previewSnapshotStillCurrent(
  snapshot: string,
  bufferText: string,
  diskText: string
): boolean {
  return samePreviewText(bufferText, snapshot) && samePreviewText(diskText, snapshot);
}

export type DryRunFollowUp = "apply" | "stop" | "conflicts";

/**
 * Exit 8 is a merge conflict. `--apply` exits 8 again and does not write.
 * `--allow-conflicts` previews as exit 2, so that choice still reaches Apply.
 */
export function dryRunFollowUp(
  noun: "apply" | "merge",
  result: { readonly exitCode: number; readonly stdout: string }
): DryRunFollowUp {
  if (previewDryRunMayContinue(result)) {
    return "apply";
  }
  if (noun === "merge" && result.exitCode === 8) {
    return "conflicts";
  }
  return "stop";
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
