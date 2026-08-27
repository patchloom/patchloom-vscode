/** Overlay `patchloom.env` onto a process env. Empty/undefined extra is identity. */
export function mergePatchloomEnv(
  base: NodeJS.ProcessEnv,
  extra: Record<string, string> | undefined
): NodeJS.ProcessEnv {
  if (extra === undefined || Object.keys(extra).length === 0) {
    return base;
  }
  return { ...base, ...extra };
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
      message = `${message} (suggested_op: ${parsed.suggested_op})`;
    }
    return message;
  } catch {
    return undefined;
  }
}