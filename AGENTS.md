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
| `npm run test:coverage` | Unit tests with line coverage (80% threshold) |
| `npm run package` | Package the `.vsix` using `@vscode/vsce` |
| `npm run check` | Full CI gate: test + coverage + package |

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
    managedInstall.ts    Managed Install commands: install, update, reinstall Patchloom binary
    quickActions.ts       Quick Action command: replace, tidy, doc set, search, create, doc get, patch merge
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
    binary.test.ts       Binary discovery, managed install, compatibility, workspace env (53 tests)
    binaryDiscovery.test.ts  Real executable discovery on PATH (13 tests)
    initializeProject.test.ts  Status display, agents file classification, formatError (23 tests)
    managedLifecycle.test.ts   Managed install with real file I/O (22 tests)
    mcpConfig.test.ts    MCP config with real temp directories (9 tests)
    outputChannel.test.ts Output channel logging wrapper (10 tests)
    patchloomCli.test.ts Patchloom CLI integration with real binary + managed install e2e MCP (50+ tests incl. e2e)
    propertyBased.test.ts  Property-based tests with fast-check (13 tests)
    quickActions.test.ts Quick action command building, path containment, patch merge (46 tests)
    verifyMcp.test.ts    MCP server verify and JSON-RPC response parsing (15 tests)
    downloadIntegration.test.ts  HTTP download, redirect, streaming SHA-256 (9 tests)
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
    auto-approve.yml           Auto-approve PRs from SebTardif and dependabot[bot]
    dependabot-auto-merge.yml  Auto-merge minor/patch Dependabot PRs
    post-merge.yml             Trigger CI/security/scorecard on main after auto-merge
    scorecard.yml              OpenSSF Scorecard analysis (weekly + on push)
    release.yml                Release: release-please + .vsix packaging and upload
    security.yml               Security: npm audit, Trivy fs scan, Gitleaks (weekly + on push/PR)
release-please-config.json   Release-please configuration (node release type)
.release-please-manifest.json  Current version tracking for release-please
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
- When adding commands to `package.json`, update the expected count in `test/suite/index.ts`.
- **Branch & PR workflow (never push a branch and stop):** For any trackable work,
  after the first `git push` immediately create a draft PR (`gh pr create --draft`).
  Continue development with normal `git push` (updates the draft PR + CI).
  Only run `gh pr ready <number>` (and enable auto-merge if needed) when the
  changes are ready for review/merge. This ensures every pushed branch is
  backed by an open (draft) PR from the start. See `~/.grok/skills/owned-repo-gate/SKILL.md`.

- **Auto-approve self-modification gotcha:** PRs that change `.github/workflows/auto-approve.yml`
  often cause the Auto-approve workflow to only emit "push" validation runs (0 jobs, failure).
  No review is added via the normal `pull_request` path → REVIEW_REQUIRED / BLOCKED
  despite green checks. Temporary fix: add yourself as bypass actor in the ruleset,
  `gh pr merge --admin`, **immediately** remove the bypass. The `require_last_push_approval`
  rule can still force `--admin` even with bypass. See ci-branch-protection skill + #159.

## Release PRs - Strong Guard

Release PRs (created by release-please, titled "chore: release ..." or "chore(main): release ...", or labeled `autorelease: pending`) MUST NEVER be merged (with `gh pr merge`, `--auto`, or otherwise) without the user's explicit approval.

Merging a release PR:
- Publishes a new version of the VSIX
- Creates git tags
- Triggers the full release pipeline (Marketplace, Open VSX, attestation bundles)
- The user controls release cadence, not the agent.

### Required procedure (strong guard)

When you encounter a release PR (during triage, gate check, `gh pr list`, or status):

1. Report it clearly: "Release PR #N (vX.Y.Z) is ready to merge."
2. Use the `ask_user_question` tool (or direct question) to ask: "Should I merge it?"
3. **Only after receiving an explicit "yes" (or equivalent affirmative) from the user in this session**, proceed.
4. Before executing any merge command, run the guard:
   ```
   bash scripts/guard-no-release-merge.sh <number>
   ```
   The script will abort with guidance unless `ALLOW_RELEASE_MERGE=yes` is set (only after user yes).
5. If checks pass and user said yes: `gh pr merge <number> --squash` (or let auto if user directed).

This rule was strengthened after an incident where `gh pr merge 144 --auto` (under a broad "merge everything" instruction) resulted in v0.0.5 being published without explicit per-release "yes".

### Defense in depth

- Workflow: `.github/workflows/auto-approve.yml` uses author + label check + wf-changes to never enable `--auto` for release PRs.
- Script: `scripts/guard-no-release-merge.sh` provides a hard runtime guard for shell commands.
- Documentation: This section + global AGENTS.md rule.
- Branch protection + ruleset: still enforces checks, but does not replace user approval for releases.

Never bypass the guard "just this once" or rationalize. Ask every time.
