# Changelog

## 0.0.1

### Binary discovery and status

- Detect Patchloom from `patchloom.path`, `PATH`, or a managed install location
- Show a status bar item with binary readiness and CLI version
- Report CLI compatibility diagnostics with upgrade guidance for outdated builds
- Support remote, WSL, SSH, dev container, and Codespaces environments

### Workspace setup

- `Patchloom: Initialize Project` creates or diffs `AGENTS.md` from `patchloom agent-rules`
- `Patchloom: Setup Workspace` walks through binary, AGENTS.md, and MCP config readiness
- `Patchloom: Configure MCP` injects Patchloom MCP server config into VS Code, Cursor, and Windsurf targets
- `Patchloom: Quick Action` builds CLI commands from an interactive picker with six operations: replace, tidy, doc set, search, create, and doc get
- `Patchloom: Batch Apply` opens a JSON plan template and executes all operations atomically via `patchloom batch`
- `Patchloom: Show Output` opens the Patchloom output channel where all CLI invocations and results are logged
- Multi-root workspaces prompt for the target folder when no editor is active

### Managed install safety

- Checksum parsing and SHA-256 verification helpers for release archives
- Trusted GitHub release download URL validation
- Staged install path planning with separate staging and live binary directories
- Rollback-safe binary promotion that restores the previous binary on failure
- Persisted failure diagnostics that survive extension reloads
- Staging directory cleanup for failed or cancelled install attempts

### Infrastructure

- Automated test harness with unit tests and VS Code extension integration tests
- CI on self-hosted runner
- Extension packaging with `@vscode/vsce`
