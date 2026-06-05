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

export function formatCliOutput(result: { exitCode: number; stdout: string; stderr: string }): string {
  const output = `${result.stderr}\n${result.stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ");
  return output || `exit code ${result.exitCode}`;
}