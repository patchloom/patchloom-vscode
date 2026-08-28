# Patchloom for VS Code 0.6.0

This release adds Quick Actions for multi-match document edits and applying a patch file. It also fixes Native MCP registration and Configure MCP so the CLI shows up in VS Code and Cursor without wiping existing config.

## Highlights

Three new Quick Actions cover updating or deleting matching JSON, YAML, or TOML nodes, and applying a unified diff, Codex Begin Patch, or Aider SEARCH/REPLACE. Native MCP now registers in VS Code 1.100+ and runs in the open workspace folder. Configure MCP keeps JSONC comments and writes Cursor's `mcpServers` key.

Minimum supported CLI remains **0.3.0**. Recommended CLI is still **0.31.0**. No settings migration is required.

## New features

- **Update matching structured values.** Quick Action runs `patchloom doc update` (CLI 0.27+) to change every JSON, YAML, or TOML node that matches a wildcard or predicate, with the same preview-then-apply flow as other document edits ([#246](https://github.com/patchloom/patchloom-vscode/pull/246)).
- **Delete matching array items.** Quick Action runs `patchloom doc delete-where` (CLI 0.27+) with an array path plus a `key=value` predicate. A miss is treated as a hard failure, not a silent no-op ([#246](https://github.com/patchloom/patchloom-vscode/pull/246)).
- **Apply patch (unified / Begin Patch / SEARCH-REPLACE).** Quick Action runs `patchloom patch apply` (CLI 0.30+) on a unified diff, Codex `*** Begin Patch`, or Aider SEARCH/REPLACE file. Merge patch remains the three-way path for stale unified diffs ([#246](https://github.com/patchloom/patchloom-vscode/pull/246)).

## Bug fixes

- **Native MCP never appeared in VS Code 1.100+.** The provider called a method name that does not exist, so registration did nothing. It now registers a stdio server with the resolved CLI path and only `PATCHLOOM_*` environment keys ([#249](https://github.com/patchloom/patchloom-vscode/pull/249), [#250](https://github.com/patchloom/patchloom-vscode/pull/250)).
- **Native MCP tools resolved relative paths from your home directory.** The server working directory is now the first workspace folder ([#251](https://github.com/patchloom/patchloom-vscode/pull/251)).
- **Configure MCP wiped comments and sibling servers in JSONC.** A parse failure used to become an empty object and then a rewrite. Invalid files are refused; valid JSONC keeps comments and other servers ([#248](https://github.com/patchloom/patchloom-vscode/pull/248)).
- **Cursor wrote VS Code's `servers` key.** `.cursor/mcp.json` now uses `mcpServers`. A Cursor file that only has `servers` is no longer treated as already configured ([#252](https://github.com/patchloom/patchloom-vscode/pull/252), [#253](https://github.com/patchloom/patchloom-vscode/pull/253)).
- **A broken `patchloom.path` kept offering Install.** When the setting points at a missing or outdated binary, the status action is Open Settings, not a managed Install or Update ([#249](https://github.com/patchloom/patchloom-vscode/pull/249)).
- **Update Patchloom compared the latest release to the active PATH or settings binary.** Managed Update now compares GitHub latest to the binary in extension storage ([#244](https://github.com/patchloom/patchloom-vscode/pull/244)).
- **A path or value of `--apply` or `--contain` dropped workspace sandboxing or turned a confirmed apply into a dry run.** Those tokens stay operands. Files named `--apply` and option values such as `-n` are passed so the CLI does not treat them as flags ([#254](https://github.com/patchloom/patchloom-vscode/pull/254), [#256](https://github.com/patchloom/patchloom-vscode/pull/256), [#257](https://github.com/patchloom/patchloom-vscode/pull/257)).
- **A workspace symlink to an outside patch escaped `--contain`.** Apply now follows the real path and stages an outside target under `.patchloom-*` so the write sandbox stays on ([#247](https://github.com/patchloom/patchloom-vscode/pull/247)).
- **Search failures stayed in a toast.** Errors now also write the CLI text to the Patchloom output channel ([#244](https://github.com/patchloom/patchloom-vscode/pull/244)).

## Numbers

| Metric | Previous | Current |
|--------|----------|---------|
| Extension version | 0.5.0 | 0.6.0 |
| Recommended CLI | 0.31.0 (minimum still 0.3.0) | 0.31.0 (minimum still 0.3.0) |
| Unit tests | 373 passed, 6 skipped | 431 passed, 7 skipped |
| MCP tools (CLI 0.31 full / core) | 58 / 11 | 58 / 11 |

## Upgrading

1. Update the extension to **0.6.0** (VS Code Marketplace, Open VSX, or `.vsix` from the GitHub Release).
2. Update the Patchloom CLI using the channel that matches how the extension resolved it (see **Patchloom: Show Status** → Source):

```bash
# Managed install (extension storage): command palette
# Patchloom: Update Patchloom

# PATH via Scoop (preferred Windows PATH channel)
scoop update patchloom

# PATH via Homebrew
brew upgrade patchloom

# npm / cargo / shell installer: see README Install section
```

3. Confirm with **Patchloom: Show Status** that the detected CLI is **0.31.0** or newer (0.3.0+ still runs; 0.31.0 is recommended). The new Quick Actions need CLI **0.27.0+** for `doc update` / `doc delete-where` and **0.30.0+** for `patch apply`.
4. Optional: run **Configure MCP** if you use Cursor or a commented `.vscode/mcp.json`, then **Update matching structured values** or **Apply patch (unified / Begin Patch / SEARCH-REPLACE)** from the Quick Action picker.

## Install

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patchloom.patchloom)
- [Open VSX](https://open-vsx.org/extension/patchloom/patchloom)
- GitHub Release assets: `patchloom.vsix` and build provenance (`patchloom.vsix.intoto.jsonl`)

## Full changelog

https://github.com/patchloom/patchloom-vscode/compare/patchloom-v0.5.0...patchloom-v0.6.0
