# AGENTS.md

## Project overview

Patchloom for VS Code is the official VS Code extension for [Patchloom](https://github.com/patchloom/patchloom). It detects the Patchloom CLI, generates agent rules, configures MCP servers, and provides quick actions from the command palette. The extension is a thin wrapper around the `patchloom` binary with dependency-injected helpers for testability.

## Dev commands

| Command | What it does |
|---------|-------------|
| `npm run compile` | Compile extension source (`tsc -p ./`) |
| `npm run compile-tests` | Compile test source (`tsc -p ./tsconfig.test.json`) |
| `npm run watch` | Watch mode for extension source |
| `npm run test:unit` | Run unit tests (`node --test ./out-test/test/unit/*.test.js`) |
| `npm run test:extension` | Run VS Code extension integration tests |
| `npm run test` | Compile + compile-tests + unit tests |
| `npm run package` | Package the `.vsix` using `@vscode/vsce` |
| `npm run check` | Full CI gate: test + package |

Always run `npm run check` before committing.

## Project structure

```
src/
  extension.ts           Thin entrypoint: registers commands, status bar, config listeners
  util.ts                Shared utilities (formatError)
  binary/patchloom.ts    Binary discovery, version parsing, compatibility assessment
  commands/
    configureMcp.ts      Configure MCP command: multi-target MCP config injection
    initializeProject.ts Initialize Project command: generate/diff AGENTS.md
    quickActions.ts       Quick Action command: replace, tidy, doc set with diff preview
    setupWorkspace.ts     Setup Workspace command: guided readiness walkthrough
    showStatus.ts         Show Status command: diagnostics display
  install/managed.ts     Managed install safety: checksum, staging, promotion, rollback, persistence
  mcp/config.ts          MCP config file operations: inspect, configure, resolve targets
  status/details.ts      Status presentation: buildStatusDetails, preferredStatusAction
  status/statusBar.ts    Status bar item: create, refresh, dispose
  workspace/readiness.ts Workspace readiness: environment detection, folder selection
test/
  unit/                  Unit tests (node:test, dependency-injected, no VS Code API)
    binary.test.ts       Binary discovery, managed install, compatibility, workspace env (38 tests)
    binaryDiscovery.test.ts  Real executable discovery on PATH (10 tests)
    initializeProject.test.ts  Status display, agents file classification (15 tests)
    managedLifecycle.test.ts   Managed install with real file I/O (10 tests)
    mcpConfig.test.ts    MCP config with real temp directories (9 tests)
    patchloomCli.test.ts Patchloom CLI integration tests with real binary (24 tests)
    quickActions.test.ts Quick action command building (6 tests)
  suite/
    index.ts             VS Code extension integration tests
    runExtensionTests.ts  Test runner using @vscode/test-electron
```

## Architecture conventions

### Entrypoint

`extension.ts` is thin. It registers commands, sets up the status bar listener, and delegates all logic to submodules.

### Dependency injection

All I/O-dependent functions accept an `inputs` object with injectable callbacks for file reads, writes, shell execution, etc. This keeps unit tests fast and deterministic. Default implementations use real `node:fs/promises` and `node:child_process`.

### Testing

- Unit tests use `node:test` and run without VS Code.
- Extension tests use `@vscode/test-electron` and launch a real VS Code instance.
- Tests compile to `out-test/` via `tsconfig.test.json`.
- Use `tempfile` directories for real I/O tests.

### Binary resolution order

1. `patchloom.path` setting (explicit user config)
2. `PATH` discovery (find executable named `patchloom`)
3. Managed install (global storage directory)

### MCP config targets

| Target | Config file | Key |
|--------|------------|-----|
| VS Code workspace | `.vscode/mcp.json` | `servers` |
| Cursor workspace | `.cursor/mcp.json` | `servers` |
| Windsurf user | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` |

## Coding conventions

- TypeScript strict mode.
- No `any` types without justification.
- Pure helpers with injected I/O for testability.
- Keep `extension.ts` thin. No business logic in the entrypoint.
- `npm run check` is the full gate. Nothing merges unless it passes.
- All commits require a `Signed-off-by` line (DCO). Use `git commit -s`.
