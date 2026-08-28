/** Overlay allowed `patchloom.env` keys onto a process env. Only `PATCHLOOM_*` keys apply. */
export function isAllowedPatchloomEnvKey(key: string): boolean {
  return key.startsWith("PATCHLOOM_");
}

export function mergePatchloomEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string> | undefined
): NodeJS.ProcessEnv {
  if (extra === undefined || Object.keys(extra).length === 0) {
    return base;
  }
  const allowed: Record<string, string> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (isAllowedPatchloomEnvKey(key)) {
      allowed[key] = value;
    }
  }
  if (Object.keys(allowed).length === 0) {
    return base;
  }
  return { ...base, ...allowed };
}

/**
 * Workspace/folder env applies only in a trusted workspace. Untrusted
 * folders may still set user/global `patchloom.env`.
 */
export function resolvePatchloomEnvFromInspect(
  isTrusted: boolean,
  inspect: {
    globalValue?: unknown;
    workspaceValue?: unknown;
    workspaceFolderValue?: unknown;
  } | undefined,
  merged: unknown
): unknown {
  if (isTrusted) {
    return merged;
  }
  return inspect?.globalValue;
}

/** `messages` and `verbose` log command lines and exit codes. */
export function shouldLogCliCommands(trace: string): boolean {
  return trace === "messages" || trace === "verbose";
}

/** Only `verbose` dumps CLI stdout/stderr into the output channel. */
export function shouldLogCliStreams(trace: string): boolean {
  return trace === "verbose";
}

export function formatError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  try {
    return String(error);
  } catch {
    return "[unknown error]";
  }
}

/**
 * Prefer machine-readable CLI JSON error envelopes (error_kind + error) when
 * present so agents and the UI surface kinds like guard_rejected (CLI 0.18+)
 * instead of a flattened multi-line dump. On CLI 0.27+, append suggested_op
 * when present so users can retry with doc.update / doc.delete_where.
 */
export function formatCliOutput(result: { exitCode: number; stdout: string; stderr: string }): string {
  const jsonError = extractCliJsonError(result.stdout) ?? extractCliJsonError(result.stderr);
  if (jsonError !== undefined) {
    return jsonError;
  }

  const output = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
  return output || `exit code ${result.exitCode}`;
}

/**
 * Quick Action toast wrapper around formatCliOutput. Agents still parse the
 * CLI token from formatCliOutput; picker labels are for humans in the UI.
 */
export function formatQuickActionCliOutput(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): string {
  return formatCliOutput(result)
    .replaceAll(
      "(try doc.update)",
      '(try Quick Action "Update matching structured values" or CLI doc.update)'
    )
    .replaceAll(
      "(try doc.delete_where)",
      '(try Quick Action "Delete matching array items" or CLI doc.delete_where)'
    );
}

function extractCliJsonError(stream: string): string | undefined {
  const trimmed = stream.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: unknown;
      error_kind?: unknown;
      suggested_op?: unknown;
    };
    if (typeof parsed.error !== "string" || parsed.error.length === 0) {
      return undefined;
    }
    // CLI often prefixes "guard_rejected: …" already; avoid "kind: kind: …".
    let message: string;
    if (
      typeof parsed.error_kind === "string" &&
      parsed.error_kind.length > 0 &&
      !parsed.error.startsWith(`${parsed.error_kind}:`)
    ) {
      message = `${parsed.error_kind}: ${parsed.error}`;
    } else {
      message = parsed.error;
    }
    // CLI 0.27+: fail-closed doc navigation may hint the multi-match sibling.
    if (typeof parsed.suggested_op === "string" && parsed.suggested_op.length > 0) {
      message = `${message} (try ${parsed.suggested_op})`;
    }
    return message;
  } catch {
    return undefined;
  }
}