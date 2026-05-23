# Patchloom for VS Code

Patchloom for VS Code is the official editor extension for Patchloom. It helps you discover the Patchloom binary, inspect its current status, and bootstrap a workspace for agent-driven Patchloom workflows.

The current extension requires Patchloom CLI `0.1.0` or newer. Older CLI builds are detected and surfaced with upgrade guidance.

## Current scope

This initial scaffold focuses on the local-binary-first MVP:

- detect Patchloom from `patchloom.path` or `PATH`
- show a status bar indicator
- provide `Patchloom: Show Status`
- provide `Patchloom: Initialize Project`
  - if `AGENTS.md` does not exist, create it from `patchloom agent-rules`
  - if `AGENTS.md` already exists, open generated rules in a new tab for manual merge

Managed binary downloads, MCP config injection, and marketplace publishing workflows are tracked as follow-up issues.

## Commands

- `Patchloom: Show Status`
- `Patchloom: Setup Workspace`
- `Patchloom: Initialize Project`
- `Patchloom: Configure MCP`
- `Patchloom: Quick Action`
- `Patchloom: Open Settings`
- `Patchloom: Open Releases`

## Settings

- `patchloom.path`: absolute path to the Patchloom binary
- `patchloom.showStatusBar`: enable or disable the status bar item

## Workspace and remote behavior

- In multi-root workspaces, Patchloom commands target the active editor's workspace folder first.
- If there is no active editor and multiple folders are open, Patchloom prompts you to choose the target folder.
- Local sessions support both workspace MCP config targets and the Windsurf user target.
- Remote sessions like WSL, SSH, dev containers, and Codespaces stay focused on workspace-scoped flows. User-scoped MCP config targets are intentionally hidden there.
- Unknown remote environments are surfaced as unverified so failures are explicit instead of silent.

## Local development

```bash
npm install
npm run compile
npm test
```

Then open the repo in VS Code and run the extension in the Extension Development Host.

## Packaging

```bash
npm run package
```

This creates a `.vsix` package using `@vscode/vsce`.

## Publishing

The intended release flow is:

1. publish to the VS Code Marketplace
2. publish the same build to Open VSX
3. attach the `.vsix` to the GitHub release when helpful

Publisher setup and public-release automation are intentionally deferred until the Patchloom public release work is ready.
