# Patchloom for VS Code 0.4.0

This release tracks [Patchloom CLI 0.28.0](https://github.com/patchloom/patchloom/releases/tag/patchloom-v0.28.0): recommended binary bump, clearer agent-facing error hints (`suggested_op`, empty paths, non-regular files), better upgrade actions by install source, and Windows install guidance that prefers managed install and Scoop over lagging community packages.

## Highlights

- **Recommended CLI is 0.28.0.** Managed **Install** / **Update Patchloom** still download the latest GitHub release with checksum verification. Minimum supported CLI remains **0.3.0**.
- **Smarter upgrade actions.** Status and command warnings pick the action that can actually fix your active binary: **Update** for managed installs, **Open Settings** for `patchloom.path`, **Open Releases** for PATH installs. Managed Update no longer pretends to replace an outdated PATH binary.
- **Richer CLI error peels in the UI.** Failure messages still prefer JSON `error` / `error_kind`, and now append `suggested_op` when the CLI provides it (for example multi-match `doc.update` after a fail-closed `doc.set`).
- **Windows install path.** Prefer the extension managed installer or Scoop. Winget and Chocolatey are called out as lagging channels; do not use them when you need the latest CLI the same day.

CLI 0.28 still exposes **58** MCP tools by default (11 in the core pack). No settings migration is required.

## Aligned with Patchloom CLI 0.25–0.28

You do not need every CLI feature to use the extension. These matter if you upgrade the binary from 0.24.x:

| CLI | What you get with a current managed install |
|-----|---------------------------------------------|
| 0.25 | Clearer create/rename peels; ambiguous markdown headings report `error_kind: ambiguous` |
| 0.26 | Multi-path specials (FIFOs and similar) report `refused[].reason: not_regular_file` instead of looking like a permission error |
| 0.27 | Fail-closed doc navigation may include `suggested_op` (`doc.update` or `doc.delete_where`) so agents and the extension can hint the multi-match sibling |
| 0.28 | Empty, whitespace-only, or format-character-only paths fail early with `error_kind: invalid_input` and message `path must not be empty` |

Workspace Quick Actions and Batch Apply still pass global `--contain`. Patch merge still skips containment when the patch file may live outside the project.

## New features

- **CLI 0.28 alignment.** Recommended version, requirements, troubleshooting, and MCP counts updated for 0.25–0.28 peels; Batch Apply template includes multi-match `doc.update` next to `doc.set` ([#226](https://github.com/patchloom/patchloom-vscode/pull/226)).
- **Shared binary remediation.** Missing or broken CLI prompts use one path for status and commands: Install, Reinstall, Update, Settings, or Open Releases depending on source and managed storage ([#228](https://github.com/patchloom/patchloom-vscode/pull/228), [#229](https://github.com/patchloom/patchloom-vscode/pull/229)).

## Bug fixes

- **Managed Update for an outdated PATH CLI left you stuck.** Resolution order is still setting, then PATH, then managed. Offering Install/Update managed when the active binary came from PATH or `patchloom.path` could refresh storage without changing what the extension runs. Upgrade actions now follow the active source ([#229](https://github.com/patchloom/patchloom-vscode/pull/229)).
- **Missing binary only offered Open Settings.** When managed install is available, status and command warnings prefer **Install Patchloom** or **Reinstall Patchloom** instead of sending you only to settings ([#228](https://github.com/patchloom/patchloom-vscode/pull/228)).

## Improvements

- **`suggested_op` in Output and notifications.** When the CLI returns a multi-match hint on fail-closed doc navigation, the extension surfaces it next to the error text ([#226](https://github.com/patchloom/patchloom-vscode/pull/226)).
- **Windows and upgrade docs.** Install and troubleshooting prefer managed install and Scoop; document Scoop/`scoop update` for PATH upgrades and managed Update for storage installs ([#226](https://github.com/patchloom/patchloom-vscode/pull/226), [#229](https://github.com/patchloom/patchloom-vscode/pull/229)).
- **Dependency hygiene.** Cleared high npm audit findings (including brace-expansion override pin) and bumped publishing/test tooling used in CI ([#228](https://github.com/patchloom/patchloom-vscode/pull/228), [#229](https://github.com/patchloom/patchloom-vscode/pull/229), [#223](https://github.com/patchloom/patchloom-vscode/pull/223), [#224](https://github.com/patchloom/patchloom-vscode/pull/224), [#225](https://github.com/patchloom/patchloom-vscode/pull/225)).

## Numbers

| Metric | Notes |
|--------|--------|
| Extension version | 0.3.0 → 0.4.0 |
| Recommended CLI | 0.24.0 → 0.28.0 (minimum still 0.3.0) |
| Unit tests | 313 (node:test unit suite on this release) |
| MCP tools (CLI 0.28 full / core) | 58 / 11 |

## Upgrading

1. Update the extension to **0.4.0** (VS Code Marketplace, Open VSX, or `.vsix` from the GitHub Release).
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

3. Confirm with **Patchloom: Show Status** that the detected CLI is **0.28.0** or newer (0.3.0+ still runs; 0.28.0 is recommended).
4. Optional: open Batch Apply and try the `doc.update` example, or trigger a command with an outdated PATH binary and confirm the status action points at **Open Releases** rather than a no-op managed update.

## Install

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patchloom.patchloom)
- [Open VSX](https://open-vsx.org/extension/patchloom/patchloom)
- GitHub Release assets: `patchloom.vsix` and build provenance (`patchloom.vsix.intoto.jsonl`)

## Full changelog

https://github.com/patchloom/patchloom-vscode/compare/patchloom-v0.3.0...patchloom-v0.4.0
