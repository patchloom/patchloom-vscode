# Patchloom for VS Code

The official VS Code extension for [Patchloom](https://github.com/patchloom/patchloom), the CLI for agent-grade repo operations. Discover the Patchloom binary, bootstrap your workspace, configure MCP servers, and run common Patchloom workflows from the command palette.

Requires Patchloom CLI `0.1.0` or newer. Older CLI builds are detected and surfaced with upgrade guidance.

## Features

- **Binary discovery** -- finds Patchloom from `patchloom.path`, `PATH`, or a managed install location
- **Status bar** -- shows binary readiness and CLI version at a glance
- **Initialize Project** -- generates `AGENTS.md` from `patchloom agent-rules` or diffs against an existing one
- **Configure MCP** -- injects the Patchloom MCP server into VS Code, Cursor, and Windsurf config files
- **Quick Action** -- builds common `patchloom` CLI commands from an interactive picker
- **Setup Workspace** -- guided walkthrough for binary, AGENTS.md, and MCP readiness
- **Compatibility diagnostics** -- warns when the CLI is outdated and links to releases

## Getting started

1. Install the [Patchloom CLI](https://github.com/patchloom/patchloom/releases)
2. Install this extension from the VS Code Marketplace
3. Open a project and run `Patchloom: Setup Workspace` from the command palette

The extension detects the CLI automatically. If Patchloom is not on `PATH`, set `patchloom.path` in your VS Code settings.

## Commands

| Command | Description |
|---------|-------------|
| `Patchloom: Show Status` | Display binary readiness, version, compatibility, and workspace state |
| `Patchloom: Setup Workspace` | Walk through binary, AGENTS.md, and MCP config readiness |
| `Patchloom: Initialize Project` | Generate or diff `AGENTS.md` from `patchloom agent-rules` |
| `Patchloom: Configure MCP` | Inject Patchloom MCP server config into editor config files |
| `Patchloom: Quick Action` | Build a Patchloom CLI command from an interactive picker |
| `Patchloom: Open Settings` | Jump to Patchloom extension settings |
| `Patchloom: Open Releases` | Open the Patchloom releases page in a browser |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `patchloom.path` | `""` | Absolute path to the Patchloom binary. When empty, the extension searches `PATH`. |
| `patchloom.showStatusBar` | `true` | Show a status bar item reporting whether Patchloom is available. |

## Remote and multi-root workspaces

- In multi-root workspaces, commands target the active editor's workspace folder first. If no editor is active, you are prompted to choose.
- Local sessions support both workspace MCP config targets and the Windsurf user target.
- Remote sessions (WSL, SSH, dev containers, Codespaces) stay focused on workspace-scoped flows. User-scoped MCP config targets are hidden in remote environments.
- Unknown remote environments are surfaced as unverified so failures are explicit.

## Troubleshooting

**Patchloom not found**
Set `patchloom.path` in settings to the absolute path of the binary, or add it to your `PATH`.

**CLI compatibility warning**
The extension requires Patchloom `0.1.0` or newer. Run `Patchloom: Open Releases` to download the latest version.

**MCP config not injected**
Run `Patchloom: Configure MCP` and select the target editor config. The extension writes to `.vscode/mcp.json`, `.cursor/mcp.json`, or `~/.codeium/windsurf/mcp_config.json`.

**Managed install failure persists after restart**
The extension stores the last managed-install failure in global storage. Run `Patchloom: Show Status` to see the diagnostic details.

## Reporting issues

File bugs and feature requests at [patchloom/patchloom-vscode/issues](https://github.com/patchloom/patchloom-vscode/issues). Include the output of `Patchloom: Show Status` and your VS Code version.

## Managed install security model

The managed installer work is intentionally conservative:

- downloads must come from `https://github.com/patchloom/patchloom/releases/download/...`
- each downloaded archive must match a published SHA-256 checksum before the extension trusts it
- checksum verification failures stop the install before any managed binary is used
- a failed verification or install does not replace an already working Patchloom binary
- downloads and extracted binaries stay in a staging area until verification succeeds
- stale staging directories are removable in one cleanup step before retries
- binary promotion renames the previous binary into a backup before swapping in the staged binary
- if replacement fails, the previous managed binary is restored before the install reports failure
- the last failure record persists in global storage so diagnostics survive extension reloads

## Local development

```bash
npm install
npm run compile
npm test
```

Open the repo in VS Code and press `F5` to launch the Extension Development Host.

## Packaging

```bash
npm run package
```

Creates a `.vsix` package using `@vscode/vsce`.
