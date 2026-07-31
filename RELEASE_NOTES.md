# Patchloom for VS Code 0.3.0

This release tracks [Patchloom CLI 0.24.0](https://github.com/patchloom/patchloom/releases/tag/patchloom-v0.24.0): recommended binary bump, Morph-style **Apply fragment at anchor**, agent-rules and MCP **core pack** options, and clearer CLI error kinds in the UI.

## Highlights

- **Recommended CLI is 0.24.0.** Managed install and **Update Patchloom** still pull the latest GitHub release. Minimum supported CLI remains **0.3.0**.
- **Apply fragment at anchor.** New Quick Action for `apply-fragment` (CLI 0.22+): place a freeform fragment with a unique `--after`, `--before`, or `--old` anchor. Morph-style marker lines are stripped. Same diff preview and Apply flow as other write actions.
- **Agent-rules surface.** **Initialize Project** can generate a full `AGENTS.md` document or a short **core** pack for system-prompt injection (`patchloom agent-rules --surface core`, CLI 0.24+).
- **MCP core pack.** **Configure MCP** can inject the full tool inventory or set `PATCHLOOM_MCP_SURFACE=core` on the server entry (11 tools on CLI 0.24, including `list_files`).
- **Clearer sole-path and fuzzy errors.** Failure messages still prefer CLI JSON `error` / `error_kind`. New kinds you may see with a current CLI include `binary`, `invalid_encoding` (0.20+), and `fuzzy_span_suspicious` (0.22+), plus existing `already_exists` (0.19+) and `guard_rejected` (0.18+).

CLI 0.24.x exposes **58** MCP tools by default (including `list_files` and `apply_fragment`). No settings migration is required. Existing `patchloom.path` values and managed installs keep working.

## Aligned with Patchloom CLI 0.19–0.24

You do not need every CLI feature to use the extension. These are the parts that matter if you upgrade the binary from 0.18.x:

| CLI | What you get with a current managed install |
|-----|---------------------------------------------|
| 0.19 | `error_kind: already_exists` on create/rename conflicts; clearer force hints |
| 0.20 | `error_kind: binary` and `invalid_encoding` for sole-path non-text loads |
| 0.22 | `apply-fragment` / MCP `apply_fragment`; `fuzzy_span_suspicious` on over-wide fuzzy matches; `PATCHLOOM_MCP_SURFACE=core` (originally 10 tools) |
| 0.23 | MCP `server_info` reports package and protocol versions; WinGet install path documented |
| 0.24 | MCP `list_files`; core pack grows to **11** tools; absolute paths allowed when they resolve inside the MCP workspace root |

Workspace Quick Actions and Batch Apply still pass global `--contain`. Patch merge still skips containment when the patch file may live outside the project. `apply-fragment` is CLI/tx/MCP only (not batch line format).

## New features

- **Apply fragment at anchor.** Palette action builds `apply-fragment <file> --after|--before|--old <anchor> --fragment <text>` with preview before apply ([#218](https://github.com/patchloom/patchloom-vscode/pull/218)).
- **Initialize Project surface picker.** Choose full agent-rules document or core pack (`--surface core`) alongside mode and platform ([#219](https://github.com/patchloom/patchloom-vscode/pull/219)).
- **Configure MCP surface picker.** Full inventory (default) or core pack via `PATCHLOOM_MCP_SURFACE=core` in the generated editor config ([#219](https://github.com/patchloom/patchloom-vscode/pull/219)).

## Improvements

- **Docs for CLI 0.19–0.24.** Recommended version, requirements blurb, troubleshooting for binary/encoding/fuzzy peels and `already_exists`, MCP tool counts, WinGet install, and walkthrough steps for surface/core options ([#217](https://github.com/patchloom/patchloom-vscode/pull/217), [#218](https://github.com/patchloom/patchloom-vscode/pull/218), [#219](https://github.com/patchloom/patchloom-vscode/pull/219)).
- **Dependency hygiene.** Cleared remaining brace-expansion audit pressure under mocha; Actions and test-electron Dependabot bumps ([#217](https://github.com/patchloom/patchloom-vscode/pull/217), [#215](https://github.com/patchloom/patchloom-vscode/pull/215), [#216](https://github.com/patchloom/patchloom-vscode/pull/216)).
- **Release merge guard.** Scripts no longer claim a PR is safe to merge after an intentional release override; release-please PRs still need an explicit go-ahead ([#213](https://github.com/patchloom/patchloom-vscode/pull/213)).

## Upgrading

1. Update the extension to **0.3.0** (VS Code Marketplace, Open VSX, or `.vsix` from the GitHub Release).
2. Update the Patchloom CLI when you can:

```bash
# Managed install from the command palette:
# Patchloom: Update Patchloom

# Or install/upgrade via your preferred channel, then reopen VS Code
brew upgrade patchloom
# npm: npm install -g patchloom
# Scoop / Chocolatey / WinGet / cargo / shell installer: see README Install section
```

3. Confirm with **Patchloom: Show Status** that the detected CLI is **0.24.0** or newer (0.3.0+ still runs; 0.24.0 is recommended).
4. Optional: try **Apply fragment at anchor** on a short source file, regenerate **AGENTS.md** with surface **Core pack**, or re-run **Configure MCP** and pick **Core pack** for coding agents that prefer a small tool list.

## Install

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patchloom.patchloom)
- [Open VSX](https://open-vsx.org/extension/patchloom/patchloom)
- GitHub Release assets: `patchloom.vsix` and build provenance (`patchloom.vsix.intoto.jsonl`)

## Full changelog

https://github.com/patchloom/patchloom-vscode/compare/patchloom-v0.2.0...patchloom-v0.3.0
