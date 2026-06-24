## Patchloom for VS Code v0.0.6

### What's New

- **Patchloom CLI 0.5.0 support** ([#166](https://github.com/patchloom/patchloom-vscode/pull/166)): The extension now recommends CLI 0.5.0, bringing HTTP MCP transport, `execute_plan`, and an expanded library API.

### Bug Fixes

- **Accurate CLI compatibility checking** ([#167](https://github.com/patchloom/patchloom-vscode/pull/167)): The minimum CLI version is now correctly set to **0.3.0**. Previously, the extension reported compatibility with CLI 0.1.0, but commands like `append` and `patch merge` did not exist until later versions. Users on older CLIs now get a clear upgrade prompt instead of silent failures.

- **Improved test reliability** ([#157](https://github.com/patchloom/patchloom-vscode/pull/157)): End-to-end MCP tests are more resilient on slower machines with increased timeouts, reducing false failures during managed install verification.

### Internal

- Docs-only changes now skip the full build/test matrix ([#162](https://github.com/patchloom/patchloom-vscode/pull/162))
- Hardened auto-approve workflow against self-modification edge cases ([#160](https://github.com/patchloom/patchloom-vscode/pull/160))
- Fixed Scorecard workflow YAML parsing issues ([#163](https://github.com/patchloom/patchloom-vscode/pull/163), [#164](https://github.com/patchloom/patchloom-vscode/pull/164))
- Fixed release PRs getting stuck as BLOCKED despite green CI ([#157](https://github.com/patchloom/patchloom-vscode/pull/157))
