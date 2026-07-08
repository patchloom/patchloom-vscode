# Patchloom for VS Code 0.0.9

This release aligns the extension with [Patchloom CLI v0.10.0](https://github.com/patchloom/patchloom/releases/tag/patchloom-v0.10.0): safer workspace CLI runs, a working Create file action on current CLI builds, and a few high-value Quick Action and Initialize Project improvements.

## Highlights

- **Create file actually creates files** on CLI 0.9+ and 0.10+. The action now collects initial content and always passes `--apply` (preview-only create returns exit code 2 and does not write).
- **Workspace path guarding** for Quick Actions and Batch Apply via CLI `--contain` (0.10+), so edits stay inside the open folder.
- **Prepend to file** Quick Action (CLI 0.9+) and richer **Initialize Project** options for `agent-rules` mode and platform.

Recommended CLI: **0.10.0+** (minimum remains 0.3.0). Managed install and Marketplace auto-update pull the latest CLI when available.

## Aligned with Patchloom CLI v0.10

CLI 0.8–0.10 added agent reliability features the extension now tracks:

| CLI | What matters for the extension |
|-----|--------------------------------|
| 0.8 | 54 MCP tools (up from 43), `server_info`, better tool discovery |
| 0.9 | File `prepend` command; MCP doc params use `selector` (not `key`) |
| 0.10 | Preview exit code 2 when changes would apply; optional global `--contain` |

Docs and tests follow those contracts so the extension stays compatible with the latest managed CLI install.

## New features

- **Prepend to file.** Quick Action for `patchloom prepend <file> --content <text>` with the same diff preview and Apply flow as Append. (#189)
- **`--contain` on workspace edits.** Quick Actions and Batch Apply run the CLI with global `--contain` so paths cannot escape the workspace root. Patch merge opts out so you can still apply a patch file stored outside the project. (#189)
- **Initialize Project mode and platform.** When generating or diffing `AGENTS.md`, pick integration mode (all / CLI only / MCP only) and shell platform (all / Linux-macOS / Windows) for `patchloom agent-rules`. (#189)

## Bug fixes

- **Create a new file.** Previously the action ran `patchloom create <path>` without `--content` or `--apply`. Current CLI requires content (or stdin) and only writes when `--apply` is set. You are prompted for initial content (empty is allowed), then the file is created and opened. (#188)
- **MCP `doc_set` e2e against latest CLI.** Managed-install end-to-end tests use the `selector` parameter for `doc_set` (CLI 0.9+), matching production MCP schema. (#185)

## Upgrading

1. Update the extension to 0.0.9 (Marketplace, Open VSX, or VSIX).
2. Update the CLI to 0.10.0+ if you can:

```bash
brew upgrade patchloom
# or
cargo install patchloom --locked
# or
# Command Palette: Patchloom: Update Patchloom
```

3. Re-run **Patchloom: Setup Workspace** or **Initialize Project** if you want fresh agent rules with the new mode/platform choices.
4. For MCP in Cursor/VS Code/Windsurf, **Configure MCP** is unchanged; restart the MCP host after a CLI upgrade so tool lists refresh.

No settings migration is required. Existing `patchloom.path` and managed installs continue to work.
