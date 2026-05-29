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
| `npm run test:ui` | Run ExTester UI tests (downloads VS Code if needed) |
| `npm run test:all` | Compile + unit tests + extension integration tests |
| `npm run test` | Compile + compile-tests + unit tests |
| `npm run package` | Package the `.vsix` using `@vscode/vsce` |
| `npm run check` | Full CI gate: test + package |

Always run `npm run check` before committing.

## Project structure

```
src/
  extension.ts           Thin entrypoint: registers commands, status bar, config listeners
  util.ts                Shared utilities (formatError, formatCliOutput)
  binary/patchloom.ts    Binary discovery, version parsing, compatibility assessment
  commands/
    configureMcp.ts      Configure MCP command: multi-target MCP config injection
    initializeProject.ts Initialize Project command: generate/diff AGENTS.md
    quickActions.ts       Quick Action command: replace, tidy, doc set, search, create, doc get
    batchApply.ts        Batch Apply command: atomic multi-operation plan via JSON
    setupWorkspace.ts     Setup Workspace command: guided readiness walkthrough
    showStatus.ts         Show Status command: diagnostics display
  install/managed.ts     Managed install safety: checksum, staging, promotion, rollback, persistence
  logging/outputChannel.ts  Output channel wrapper: log, logCommand, logResult, show, dispose
  mcp/config.ts          MCP config file operations: inspect, configure, resolve targets
  status/details.ts      Status presentation: buildStatusDetails, preferredStatusAction
  status/statusBar.ts    Status bar item: create, refresh, dispose
  workspace/readiness.ts Workspace readiness: environment detection, folder selection
test/
  unit/                  Unit tests (node:test, dependency-injected, no VS Code API)
    batchApply.test.ts   Batch template and operation count parsing (10 tests)
    binary.test.ts       Binary discovery, managed install, compatibility, workspace env (38 tests)
    binaryDiscovery.test.ts  Real executable discovery on PATH (13 tests)
    initializeProject.test.ts  Status display, agents file classification, formatError (19 tests)
    managedLifecycle.test.ts   Managed install with real file I/O (12 tests)
    mcpConfig.test.ts    MCP config with real temp directories (9 tests)
    outputChannel.test.ts Output channel logging wrapper (13 tests)
    patchloomCli.test.ts Patchloom CLI integration tests with real binary (23 tests)
    quickActions.test.ts Quick action command building, path containment (26 tests)
  suite/
    index.ts             VS Code extension integration tests
    runExtensionTests.ts  Test runner using @vscode/test-electron
  ui/
    extension.test.ts    ExTester UI tests (status bar, command palette)
scripts/
  hide-test-vscode.sh   macOS: patch test VS Code to suppress window activation
.github/
  CODEOWNERS               Owner for all files
  copilot-instructions.md  Pointer to AGENTS.md for GitHub Copilot
  dependabot.yml           Dependabot config: npm + github-actions, weekly
  ISSUE_TEMPLATE/
    bug-report.yml         Structured bug report form
    config.yml             Issue template chooser config
    feature-request.yml    Feature request form
  PULL_REQUEST_TEMPLATE.md PR template
  workflows/
    ci.yml                 CI: unit tests, build, integration tests (self-hosted)
    dependabot-auto-merge.yml  Auto-merge minor/patch Dependabot PRs
    security.yml           Security: npm audit, Trivy fs scan, Gitleaks (weekly + on push/PR)
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
- All relative imports must use `.js` extensions (`from "./foo.js"`, not `from "./foo"`). Required by `moduleResolution: "node16"`.
- All commits require a `Signed-off-by` line (DCO). Use `git commit -s`.
