# Patchloom for VS Code v0.0.4

This release brings full alignment with **Patchloom CLI v0.2.0**, new Quick Actions, improved documentation, and infrastructure hardening.

## What's new

### Patchloom CLI v0.2.0 support

- **Patch Merge Quick Action**: three-way merge is now available directly from the command palette, matching the new `patch merge` command in CLI v0.2.0.
- **Updated documentation links**: all "Open Documentation" links now point to the new docs site at [patchloom.github.io/patchloom](https://patchloom.github.io/patchloom/).
- **MCP setup guide**: the Getting Started walkthrough now includes a direct link to the MCP configuration guide.

### Documentation improvements

- The README now lists all 13 commands (previously "Open Documentation" was missing).
- Four undocumented settings are now in the README: `patchloom.enable`, `patchloom.trace.server`, `patchloom.env`, and `patchloom.managedInstall.autoUpdate`.

## Under the hood

- **Security**: resolved a high-severity vulnerability in markdown-it (GHSA-6v5v-wf23-fmfq) and updated transitive dependencies.
- **Code quality**: deduplicated constants and error helpers across managed install commands, removing repeated code from three parallel functions.
- **CI**: replaced the third-party auto-approve action with a native `gh pr review` call, added a monthly PAT expiry reminder workflow, and added support for curated release notes.
- **Dependencies**: bumped `@vscode/test-electron` to v3, `@types/node`, `ovsx`, and `actions/attest-build-provenance` to v4.

## Test coverage

252 unit tests, 91% line coverage, zero npm audit vulnerabilities.
