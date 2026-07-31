<p align="center">
  <img src="images/logo-512.png" alt="Patchloom logo" width="200">
</p>

# Patchloom for VS Code

[![CI](https://github.com/patchloom/patchloom-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/patchloom/patchloom-vscode/actions/workflows/ci.yml)
[![Security](https://github.com/patchloom/patchloom-vscode/actions/workflows/security.yml/badge.svg)](https://github.com/patchloom/patchloom-vscode/actions/workflows/security.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/SebTardif/d01e4551b744b77e2927555e43a4b935/raw/coverage.json)](https://github.com/patchloom/patchloom-vscode/actions/workflows/ci.yml)
[![VS Code Marketplace](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/SebTardif/d01e4551b744b77e2927555e43a4b935/raw/version.json)](https://marketplace.visualstudio.com/items?itemName=patchloom.patchloom)
[![Open VSX](https://img.shields.io/open-vsx/v/patchloom/patchloom)](https://open-vsx.org/extension/patchloom/patchloom)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/patchloom/patchloom-vscode/badge)](https://securityscorecards.dev/viewer/?uri=github.com/patchloom/patchloom-vscode)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/13100/badge)](https://www.bestpractices.dev/projects/13100)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/patchloom/patchloom-vscode/blob/main/LICENSE)

The official VS Code extension for [Patchloom](https://github.com/patchloom/patchloom). Set up your workspace for AI agent workflows in seconds: detect the CLI, generate agent rules, configure MCP servers, and run structured file operations from the command palette.

---

## Install

Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patchloom.patchloom) or the [Open VSX Registry](https://open-vsx.org/extension/patchloom/patchloom).

Or search for **Patchloom** in the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`).

## Get started in 30 seconds

1. Install the [Patchloom CLI](https://github.com/patchloom/patchloom) (or run **Patchloom: Install Patchloom** from the command palette)
   ```sh
   brew install patchloom/tap/patchloom          # macOS / Linux (Homebrew)
   npm install -g patchloom                      # npm (Node.js)
   curl -LsSf https://github.com/patchloom/patchloom/releases/latest/download/patchloom-installer.sh | sh  # shell script
   cargo install patchloom                        # from source
   scoop bucket add patchloom https://github.com/patchloom/scoop-bucket
   scoop install patchloom                        # Windows (Scoop)
   choco install patchloom                        # Windows (Chocolatey; first listing may wait on moderation)
   winget install Patchloom.Patchloom             # Windows (WinGet; when the community PR is approved)
   ```
2. Open a project and run **Patchloom: Setup Workspace**

<p align="center">
  <img src="images/setup-workspace-demo.gif" alt="Setup Workspace demo" width="800">
</p>

The extension finds the CLI automatically. If it's not on `PATH`, point `patchloom.path` to it in settings.

---

## Features

### One-click workspace setup

Run `Patchloom: Setup Workspace` to walk through everything your project needs: binary detection, `AGENTS.md` generation, and MCP server configuration.

### Agent rules generation

`Patchloom: Initialize Project` generates an `AGENTS.md` file from `patchloom agent-rules`. If one already exists, the extension opens a diff so you can merge updates manually.

### MCP server configuration

`Patchloom: Configure MCP` injects the Patchloom MCP server into your editor's config. Supports:

- **VS Code** (`.vscode/mcp.json`)
- **Cursor** (`.cursor/mcp.json`)
- **Windsurf** (`~/.codeium/windsurf/mcp_config.json`)

CLI 0.24.0 exposes **58** MCP tools by default (including `list_files` and `apply_fragment`). For coding agents that need a smaller handshake inventory, set `PATCHLOOM_MCP_SURFACE=core` in the server environment (11 tools: `read_file`, `search_files`, `list_files`, `replace_text`, `batch_replace`, `doc_get`, `doc_set`, `doc_query`, `md_replace_section`, `execute_plan`, `server_info`). Absolute paths that resolve inside the MCP workspace root are allowed; `../` and outside paths still reject.

### Status bar

The status bar shows MCP and binary readiness at a glance:

- **$(plug) Patchloom MCP** when the MCP server is configured
- **$(check) Patchloom** when the binary is ready but MCP is not yet set up
- **$(warning) Patchloom** when the binary is missing or needs an upgrade

Click it to see full diagnostics, including per-editor MCP configuration status (VS Code, Cursor, Windsurf).

### Verify MCP Server

`Patchloom: Verify MCP Server` spawns `patchloom mcp-server`, sends a JSON-RPC `initialize` handshake, and confirms the server responds correctly. Reports the server name and version on success, or a diagnostic error on failure.

### Quick actions

`Patchloom: Quick Action` opens an interactive picker with structured editing operations:

| Action | What it does |
|--------|-------------|
| **Replace text** | Literal text replacement with diff preview before applying |
| **Insert text after match** | Line-oriented insert after each match (CLI 0.16+) |
| **Insert text before match** | Line-oriented insert before each match (CLI 0.16+) |
| **Apply fragment at anchor** | Morph-style freeform fragment at a unique anchor (`--after` / `--before` / `--old`, CLI 0.22+) |
| **Tidy file** | Whitespace and newline cleanup with diff preview |
| **Set structured value** | Update a JSON, YAML, or TOML key with diff preview |
| **Search text** | Find pattern matches across workspace files (results in output channel) |
| **Create file** | Scaffold a new file with optional content and open it in the editor |
| **Append to file** | Append content to an existing file |
| **Prepend to file** | Prepend content to the start of an existing file (CLI 0.9+) |
| **Read structured value** | Read a JSON/YAML/TOML key and copy to clipboard |
| **Delete structured value** | Remove a key from JSON, YAML, or TOML with diff preview |
| **Merge into structured file** | Merge a partial JSON object into a config file (optional multi-doc selector, CLI 0.16+) |
| **Append to array** | Append a value to a JSON, YAML, or TOML array |
| **Prepend to array** | Prepend a value to a JSON, YAML, or TOML array |
| **Ensure structured value** | Idempotent set: write only if the key is missing |
| **Move/rename key** | Move or rename a selector path in JSON, YAML, or TOML |
| **Insert after heading** | Insert content immediately after a markdown heading line |
| **Insert after section** | Insert a sibling markdown section after a full section body (CLI 0.14+) |
| **Insert before heading** | Insert content immediately before a markdown heading line |
| **Append table row** | Append a row to a markdown table under a heading |
| **Upsert bullet** | Add a bullet under a heading if it is not already present |
| **Replace markdown section** | Replace content under a markdown heading |
| **Merge patch (three-way)** | Apply a stale patch using three-way merge (v0.2.0+) |
| **Undo last change** | Restore files from the latest Patchloom backup session |

Workspace Quick Actions and Batch Apply pass `--contain` so CLI paths stay inside the workspace root (CLI 0.10+). Containment is relative to the effective working directory (the workspace folder). Patch merge skips containment when the patch file may live outside the workspace.

### Batch operations

`Patchloom: Batch Apply` opens a line-oriented plan template where you can compose multiple operations (replace, fuzzy replace, doc set, multi-doc `doc.merge`, file append, markdown section inserts, tidy). The extension pipes the plan to `patchloom batch --apply` so all changes land atomically.

### Output channel

All CLI invocations, arguments, and output are logged to the **Patchloom** output channel. Run `Patchloom: Show Output` to open it. Useful for debugging and copying full error messages for bug reports.

### Compatibility diagnostics

The extension detects outdated CLI builds and warns with upgrade guidance. It requires Patchloom `0.3.0` or newer.

---

## Commands

| Command | Description |
|---------|-------------|
| `Patchloom: Setup Workspace` | Guided walkthrough for binary, AGENTS.md, and MCP readiness |
| `Patchloom: Initialize Project` | Generate or diff `AGENTS.md` from `patchloom agent-rules` (mode: all/cli/mcp, platform: all/linux/windows) |
| `Patchloom: Configure MCP` | Inject Patchloom MCP server config into editor config files |
| `Patchloom: Quick Action` | Build a Patchloom CLI command from an interactive picker |
| `Patchloom: Batch Apply` | Open a batch plan and execute all operations atomically |
| `Patchloom: Show Output` | Open the Patchloom output channel for CLI logs and diagnostics |
| `Patchloom: Show Status` | Display binary readiness, version, compatibility, and workspace state |
| `Patchloom: Verify MCP Server` | Spawn the MCP server and verify it responds to a JSON-RPC initialize request |
| `Patchloom: Install Patchloom` | Download and install the Patchloom CLI with checksum verification |
| `Patchloom: Update Patchloom` | Update a managed Patchloom install to the latest release |
| `Patchloom: Reinstall Patchloom` | Re-download and reinstall the managed Patchloom binary |
| `Patchloom: Open Settings` | Jump to Patchloom extension settings |
| `Patchloom: Open Documentation` | Open the Patchloom documentation site in a browser |
| `Patchloom: Open Releases` | Open the Patchloom releases page in a browser |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `patchloom.path` | `""` | Absolute path to the Patchloom binary. When empty, the extension searches `PATH` and then the managed install location. |
| `patchloom.showStatusBar` | `true` | Show a status bar item reporting whether Patchloom is available. |
| `patchloom.enable` | `true` | Enable the extension. When disabled, the status bar is hidden and background checks are skipped. |
| `patchloom.trace.server` | `"off"` | Trace level for CLI output (`off`, `messages`, `verbose`). |
| `patchloom.env` | `{}` | Additional environment variables passed to the CLI (e.g., `{"PATCHLOOM_LOG": "debug"}`). |
| `patchloom.managedInstall.autoUpdate` | `true` | Automatically check for CLI updates on activation. |

---

## Remote and multi-root workspaces

- In multi-root workspaces, commands target the active editor's workspace folder. If no editor is active, you pick the folder.
- Remote sessions (WSL, SSH, dev containers, Codespaces) stay focused on workspace-scoped flows. User-scoped MCP config targets are hidden in remote environments.
- Unknown remote environments are surfaced as unverified so failures are explicit.

---

## Troubleshooting

**Patchloom not found**
Set `patchloom.path` in settings, or add the CLI to your `PATH`.

**CLI compatibility warning**
Run `Patchloom: Open Releases` to download the latest release. The extension requires 0.3.0 or newer; 0.24.0 is recommended.

**Path rejected by workspace guard**
Quick Actions and Batch Apply pass `--contain` so paths stay inside the open workspace folder. On CLI 0.18+, sandbox escapes report `error_kind: guard_rejected` (not a generic `invalid_input`). Keep targets under the workspace root, or open the folder that owns the files.

**Batch replace shape**
Batch lines use `replace PATH OLD NEW` (and optional flags such as `--fuzzy`). Do not paste CLI form `replace OLD --new NEW path` into a batch plan; CLI 0.18+ returns a clear parse error with the PATH OLD NEW hint.

**Create or rename destination already exists**
On CLI 0.19+, create/rename conflicts report `error_kind: already_exists` (not a generic `invalid_input`). Use the force flag when overwriting is intentional, or pick a free destination path.

**Binary or invalid UTF-8 target**
On CLI 0.20+, sole-path loads of binary or invalid UTF-8 files report `error_kind: binary` or `invalid_encoding` (not a soft `no_matches`). Use a text file, or force-create when overwriting non-text is intentional.

**Fuzzy match span refused**
On CLI 0.22+, over-wide fuzzy matches can report `error_kind: fuzzy_span_suspicious`. Prefer an exact `old` string, structured `doc`/`md`/`ast` edits, or `apply-fragment` with a unique anchor.

**MCP config not injected**
Run `Patchloom: Configure MCP` and select the target editor config.

**Managed install failure persists after restart**
Run `Patchloom: Show Status` to see persisted diagnostic details.

**Debugging CLI errors**
Run `Patchloom: Show Output` to see full CLI invocations, arguments, stdout, and stderr in the output channel.

---

## Security model

The managed installer work is intentionally conservative:

- Downloads must come from `https://github.com/patchloom/patchloom/releases/download/...`
- Each archive must match a published SHA-256 checksum before the extension trusts it
- Checksum failures stop the install before any managed binary is used
- A failed install never replaces an already working binary
- Binary promotion creates a backup before swapping; failures restore the backup
- Failure records persist across extension reloads for diagnostics

---

## Reporting issues

File bugs and feature requests at [patchloom/patchloom-vscode/issues](https://github.com/patchloom/patchloom-vscode/issues). Include the output of `Patchloom: Show Status` and your VS Code version.

---

## Requirements

- VS Code 1.90 or newer (or compatible editors: Cursor, Windsurf, VSCodium)
- [Patchloom CLI](https://github.com/patchloom/patchloom) 0.3.0 or newer (0.24.0+ recommended for `list_files` MCP inventory, `apply-fragment`, `error_kind` peels including `binary` / `invalid_encoding` / `fuzzy_span_suspicious` / `already_exists` / `guard_rejected`, optional `PATCHLOOM_MCP_SURFACE=core` 11-tool pack, multi-doc `doc merge --selector`, line-oriented inserts, batch `replace PATH OLD NEW` hints, 58 MCP tools, JSON `applied` honesty, and agent-facing envelopes)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide. Quick start:

```bash
npm install
npm run check          # full gate: compile + test + package
```

Open the repo in VS Code and press `F5` to launch the Extension Development Host.
