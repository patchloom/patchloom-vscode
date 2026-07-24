# Patchloom for VS Code 0.2.0

This release brings the extension in line with [Patchloom CLI 0.18.0](https://github.com/patchloom/patchloom/releases/tag/patchloom-v0.18.0): multi-document YAML merge from the palette, line-oriented insert Quick Actions, clearer CLI errors in the UI, and docs that match how batch plans and workspace containment work today.

## Highlights

- **Recommended CLI is 0.18.0.** Managed install and **Update Patchloom** still pull the latest GitHub release. Minimum supported CLI remains **0.3.0**.
- **Multi-doc YAML merge.** **Merge into structured file** accepts an optional document selector and runs `doc merge --selector` (CLI 0.16+), so you can merge into document `0` without wiping a multi-document stream.
- **Insert before / after match.** Two new Quick Actions use line-oriented `replace --insert-before` and `--insert-after` (CLI 0.16+), with the same diff preview and Apply flow as replace.
- **Clearer CLI errors in the UI.** Failure messages prefer the CLI JSON `error` / `error_kind` fields. Containment failures show as `guard_rejected` (CLI 0.18+) instead of a raw multi-line dump.
- **Batch plans match modern CLI.** The Batch Apply template includes multi-doc `doc.merge`, line-oriented insert-after, and fuzzy replace. Docs spell out the batch shape: `replace PATH OLD NEW` (not the CLI `replace OLD --new NEW path` form).

MCP servers started through the extension still use `patchloom mcp-server`. Current CLI 0.18.x exposes **56 tools**, same as the 0.15 era tool surface the extension already targeted.

No settings migration is required. Existing `patchloom.path` values and managed installs keep working.

## Aligned with Patchloom CLI 0.16–0.18

You do not need every CLI feature to use the extension. These are the parts that matter if you upgrade the binary from 0.15.x:

| CLI | What you get with a current managed install |
|-----|---------------------------------------------|
| 0.16 | Multi-doc `doc merge --selector`, line-oriented `insert_before` / `insert_after`, shared binary / invalid UTF-8 path reporting |
| 0.17 | Clearer sole-path load errors and stable `error_kind` on more multi-file failure paths |
| 0.18 | `error_kind: guard_rejected` when `--contain` rejects a path; clearer batch replace parse hints (`PATH OLD NEW`) |

Workspace Quick Actions and Batch Apply still pass global `--contain` so paths stay inside the open folder. Patch merge still skips containment when the patch file may live outside the project.

## New features

- **Multi-document merge selector.** Optional selector prompt on **Merge into structured file** builds `doc merge <file> --selector <path> --value <json>` when set, and omits `--selector` for ordinary root merges. (#207)
- **Insert text after match.** Quick Action for line-oriented insert after each match. (#209)
- **Insert text before match.** Quick Action for line-oriented insert before each match. (#209)
- **Richer Batch Apply template.** Default plan includes fuzzy replace, `--insert-after=…`, multi-doc `doc.merge … 0`, markdown section insert, and tidy. (#207, #209)

## Improvements

- **JSON-aware CLI error display.** Notifications and failure strings prefer the CLI `error` field (and `error_kind` when the message does not already include it), so agents and humans see `guard_rejected` and batch parse hints cleanly. (#210)
- **Docs for CLI 0.18.** Recommended version, requirements blurb, troubleshooting for workspace guard rejections, and batch PATH OLD NEW guidance. (#210)
- **Quick Actions documentation.** Full palette table in the README, including Chocolatey install notes and multi-doc merge. (#205, #207, #209)
- **Dependency hygiene.** Transitive high-severity npm audit findings cleared (brace-expansion, fast-uri, js-yaml, linkify-it). GitHub Actions CodeQL pin updated via Dependabot. (#206, #209)

## Upgrading

1. Update the extension to **0.2.0** (VS Code Marketplace, Open VSX, or `.vsix` from the GitHub Release).
2. Update the Patchloom CLI when you can:

```bash
# Managed install from the command palette:
# Patchloom: Update Patchloom

# Or install/upgrade via your preferred channel, then reopen VS Code
brew upgrade patchloom
# npm: npm install -g patchloom
# Scoop / Chocolatey / cargo / shell installer: see README Install section
```

3. Confirm with **Patchloom: Show Status** that the detected CLI is **0.18.0** or newer (0.3.0+ still runs; 0.18.0 is recommended).
4. Optional: try **Merge into structured file** with selector `0` on a multi-doc YAML file, or **Insert text after match** on a short text file.

## Install

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patchloom.patchloom)
- [Open VSX](https://open-vsx.org/extension/patchloom/patchloom)
- GitHub Release assets: `patchloom.vsix` and build provenance (`patchloom.vsix.intoto.jsonl`)
