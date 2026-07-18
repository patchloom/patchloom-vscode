# Patchloom for VS Code 0.1.0

This is the first **0.1** release of the official VS Code extension for
[Patchloom](https://github.com/patchloom/patchloom). It pairs the extension
with [Patchloom CLI v0.15.2](https://github.com/patchloom/patchloom/releases/tag/patchloom-v0.15.2):
more install options, a new markdown Quick Action, clearer Batch Apply
examples, and docs that match the current CLI and MCP surface.

## Highlights

- **Recommended CLI is 0.15.2.** Managed install and **Update Patchloom**
  still pull the latest GitHub release. Minimum supported CLI remains **0.3.0**.
- **Insert after section.** New Quick Action for `md insert-after-section`
  (CLI 0.14+): place a sibling markdown section after a full section body,
  not just under the heading line.
- **Easier CLI installs.** README and Getting Started walkthrough cover
  Homebrew, npm (`npm install -g patchloom` / `npx`), Scoop (Windows),
  cargo, and the shell installer, in addition to **Install Patchloom**.
- **Batch plans that match modern CLI.** The Batch Apply template includes
  fuzzy replace with `--min-fuzzy-score` and `md.insert_after_section`.

MCP servers started through the extension still use `patchloom mcp-server`.
With CLI 0.15.x that exposes **56 tools** (up from 54 in the 0.10 era).

## Why 0.1.0

0.0.x covered the full setup path (managed CLI, agent rules, multi-editor
MCP, Quick Actions, Batch Apply, status bar, verify). 0.1.0 is the same
product, now versioned as a stable minor line and aligned with current
Patchloom CLI practice for agent and workspace use.

No settings migration is required. Existing `patchloom.path` values and
managed installs keep working.

## Aligned with Patchloom CLI 0.11–0.15

You do not need every CLI feature to use the extension. These are the
parts that matter if you upgrade the binary:

| CLI range | What you get with a current managed install |
|-----------|---------------------------------------------|
| 0.11–0.13 | Stronger `--contain` coverage, clearer plan/batch errors, match reporting on replace |
| 0.14 | `md insert-after-section`, batch flags such as `--fuzzy` / `--min-fuzzy-score`, more install channels (npm, Scoop, Chocolatey) |
| 0.15 | Stable MCP and JSON contracts (`selector` on doc tools, `applied` on write results), 56 MCP tools |

Workspace Quick Actions and Batch Apply still pass global `--contain` so
paths stay inside the open folder. Containment follows the effective
working directory (the workspace folder). Patch merge still skips
containment when the patch file may live outside the project.

## New features

- **Insert after section.** From **Patchloom: Quick Action**, insert
  sibling content after a full markdown section (for example a `## FAQ`
  after `## Config` without stuffing text under the Config heading).
  Same diff preview and Apply flow as other markdown actions. (#198)
- **Richer Batch Apply template.** Default plan lines demonstrate fuzzy
  replace and `md.insert_after_section` alongside replace, `doc.set`,
  `file.append`, and `tidy.fix`. (#198)
- **Install docs for npm and Scoop.** Getting started and the walkthrough
  list the channels Patchloom publishes today, so Windows and Node users
  have a clear path when they are not using Homebrew. (#198)

## Improvements

- **Docs match live CLI/MCP contracts.** Recommended version, tool count,
  and capability descriptions track CLI 0.15.2. Command shapes used by
  the extension (`replace` with `--new`, `doc` selectors, MCP `selector`,
  `agent-rules` mode/platform, line-oriented `batch`) were re-checked
  against that release. (#198)
- **Initialize Project and Batch Apply tests.** Extra coverage for
  agent-rules mode/platform picks and for Batch Apply always invoking
  `batch` with global `--contain`. (#192)

## Upgrading

1. Update the extension to **0.1.0** (VS Code Marketplace, Open VSX, or `.vsix`).
2. Update the Patchloom CLI when you can:

```bash
# Managed install (Command Palette)
# Patchloom: Update Patchloom

brew upgrade patchloom

npm install -g patchloom

scoop update patchloom

curl -LsSf https://github.com/patchloom/patchloom/releases/latest/download/patchloom-installer.sh | sh
```

3. If you use MCP in VS Code, Cursor, or Windsurf, restart the MCP host
   after a CLI upgrade so tool lists and schemas refresh.
4. Optional: run **Setup Workspace** or **Initialize Project** if you want
   a fresh `AGENTS.md` for the current CLI guidance.

### CLI version guidance

| Level | Version | Notes |
|-------|---------|--------|
| Minimum | 0.3.0 | Older builds may miss commands the extension offers |
| Recommended | **0.15.2+** | Current MCP tool set, markdown section insert, fuzzy batch flags, path containment |

## Requirements

- VS Code 1.90 or newer (or compatible editors: Cursor, Windsurf, VSCodium)
- Patchloom CLI 0.3.0 or newer (0.15.2+ recommended)

## Links

- Extension: [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patchloom.patchloom) · [Open VSX](https://open-vsx.org/extension/patchloom/patchloom)
- CLI release: [patchloom-v0.15.2](https://github.com/patchloom/patchloom/releases/tag/patchloom-v0.15.2)
- Issues: [patchloom/patchloom-vscode](https://github.com/patchloom/patchloom-vscode/issues)
