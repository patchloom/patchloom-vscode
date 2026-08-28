# Patchloom for VS Code 0.5.0

This release tracks [Patchloom CLI 0.31.0](https://github.com/patchloom/patchloom/releases/tag/patchloom-v0.31.0): recommended binary bump, a Search files without match Quick Action, and Output-channel results that no longer depend on turning on CLI trace.

## Highlights

Recommended CLI is **0.31.0**. Search, undo, patch-merge, and batch apply now write their results (and failures) to the Patchloom output channel even when `patchloom.trace.server` is `off`. Native MCP stays registered if you install the CLI after the window opens, and it follows `patchloom.path` or trust changes without a reload.

Minimum supported CLI remains **0.3.0**. No settings migration is required.

## Aligned with Patchloom CLI 0.29–0.31

You do not need every CLI feature to use the extension. These matter if you upgrade the binary from 0.28.x:

| CLI | What you get with a current managed install |
|-----|---------------------------------------------|
| 0.29 | `search -L` / `files_without_match`; `agent-rules --surface core` honors `--mode` |
| 0.30 | Numeric selectors (`servers[port>8000]`); `patch apply` accepts unified diffs, Codex `*** Begin Patch`, and Aider SEARCH/REPLACE |
| 0.31 | YAML alias-to-merge on `doc set`; create/rename report `parent path is not a directory` when a parent is a file |

MCP stays **58** tools full and **11** in the core pack. `search_files` accepts `files_without_match`. Workspace Quick Actions and Batch Apply still pass global `--contain`.

## New features

- **CLI 0.31 alignment.** Recommended version, requirements, troubleshooting, and MCP docs cover 0.29–0.31 peels ([#234](https://github.com/patchloom/patchloom-vscode/pull/234)).
- **Search files without match.** Quick Action runs `patchloom search -L` (CLI 0.29+) to list files that do not contain the pattern ([#234](https://github.com/patchloom/patchloom-vscode/pull/234)).
- **Native MCP after first-run Install.** The MCP provider registers even when the CLI is missing at activate, then picks up the binary after **Install** / **Update** / **Reinstall**. Changing `patchloom.path` or granting workspace trust refreshes that path without reloading the window ([#238](https://github.com/patchloom/patchloom-vscode/pull/238), [#241](https://github.com/patchloom/patchloom-vscode/pull/241)).

## Bug fixes

- **Search, undo, and patch merge opened an empty Output channel.** With the default `trace.server` of `off`, those commands told you to check Output and then showed nothing. Success, patch-merge conflicts (exit 8), hard errors, and Batch Apply now write stdout/stderr there. Settings text no longer implies every CLI stream is trace-gated ([#237](https://github.com/patchloom/patchloom-vscode/pull/237), [#238](https://github.com/patchloom/patchloom-vscode/pull/238)).
- **First open ran `--version` three times.** Status bar, auto-update, and native MCP now share one in-flight probe. Settings, trust, and managed install drop that probe before they refresh so a long cold start cannot pin a stale path ([#240](https://github.com/patchloom/patchloom-vscode/pull/240), [#241](https://github.com/patchloom/patchloom-vscode/pull/241)).
- **Empty Batch Apply could report success.** A whitespace-only plan now warns and does not run the CLI ([#238](https://github.com/patchloom/patchloom-vscode/pull/238)).

## Improvements

- **Safer workspace env overlay.** `patchloom.env` only forwards `PATCHLOOM_*` keys. Workspace values are ignored in an untrusted folder. Loader keys such as `PATH` and `LD_PRELOAD` are dropped ([#236](https://github.com/patchloom/patchloom-vscode/pull/236)).
- **Patch merge `--contain`.** When the patch file itself lives inside the workspace, merge uses the same write sandbox as other Quick Actions. Filenames that start with `..` stay inside the folder ([#236](https://github.com/patchloom/patchloom-vscode/pull/236)).
- **Managed install redirects.** Followed `Location` headers must stay on GitHub or known GitHub release CDN hosts ([#238](https://github.com/patchloom/patchloom-vscode/pull/238)).
- **Clearer next-step hints.** Fail-closed doc errors now say `try doc.update` instead of `suggested_op: doc.update` ([#238](https://github.com/patchloom/patchloom-vscode/pull/238)).
- **UI tests compile in CI.** ExTester sources are compiled before the UI suite so that job is no longer a no-op ([#236](https://github.com/patchloom/patchloom-vscode/pull/236)).

## Numbers

| Metric | Notes |
|--------|--------|
| Extension version | 0.4.0 → 0.5.0 |
| Recommended CLI | 0.28.0 → 0.31.0 (minimum still 0.3.0) |
| Unit tests | 373 passed, 6 skipped (node:test unit suite on this release) |
| MCP tools (CLI 0.31 full / core) | 58 / 11 |

## Upgrading

1. Update the extension to **0.5.0** (VS Code Marketplace, Open VSX, or `.vsix` from the GitHub Release).
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

3. Confirm with **Patchloom: Show Status** that the detected CLI is **0.31.0** or newer (0.3.0+ still runs; 0.31.0 is recommended).
4. Optional: run **Search files without match**, then **Patchloom: Show Output**, with `patchloom.trace.server` left at `off`. You should see the file list in the channel.

## Install

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patchloom.patchloom)
- [Open VSX](https://open-vsx.org/extension/patchloom/patchloom)
- GitHub Release assets: `patchloom.vsix` and build provenance (`patchloom.vsix.intoto.jsonl`)

## Full changelog

https://github.com/patchloom/patchloom-vscode/compare/patchloom-v0.4.0...patchloom-v0.5.0
