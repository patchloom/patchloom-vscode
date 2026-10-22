export type SetupStepState = "present" | "ran" | "skipped";

export function formatSetupSummary(
  workspaceName: string | undefined,
  agents: SetupStepState,
  mcp: SetupStepState,
  environmentNote?: string
): string {
  const where = workspaceName ? ` for ${workspaceName}` : "";
  const agentsText = agents === "present"
    ? "AGENTS.md was already present."
    : agents === "ran"
      ? "Initialize Project ran."
      : "AGENTS.md was skipped.";
  const mcpText = mcp === "present"
    ? "MCP config was already present."
    : mcp === "ran"
      ? "Configure MCP ran."
      : "MCP config was skipped.";
  const note = environmentNote ? ` ${environmentNote}` : "";
  return `Patchloom workspace setup${where} ${agentsText} ${mcpText}${note}`;
}
