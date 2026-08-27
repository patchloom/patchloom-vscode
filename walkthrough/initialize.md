# Initialize Your Project

Generate an `AGENTS.md` file that tells AI agents how to work with
your codebase.

Click **Initialize Project** above to run `patchloom agent-rules` in
your workspace. You can choose integration mode (CLI + MCP, CLI only, or
MCP only), shell platform examples (all, Linux/macOS, or Windows), and
surface (full document or core pack for system-prompt injection). On
CLI 0.29+, the core pack text follows the mode you pick.

## What AGENTS.md Contains

`AGENTS.md` is Patchloom agent-rules text: how to call the CLI and MCP
tools, command examples, and integration notes. It is not a generic
project overview (structure, build commands, or coding style).

The file is placed at the root of your workspace and works with
GitHub Copilot, Claude Code, Grok, Cursor, and other AI coding tools.
