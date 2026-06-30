# Patchloom for VS Code

This release aligns the extension with [Patchloom CLI v0.7.0](https://github.com/patchloom/patchloom/releases/tag/patchloom-v0.7.0) and completes platform parity for the managed installer.

## Aligned with Patchloom CLI v0.7.0

v0.7.0 renamed CLI arguments to match what LLMs naturally generate. The extension's Quick Action **Replace text** now uses the v0.7.0 syntax (`patchloom replace <old> --new <new> <file>`), and the MCP e2e test suite is updated for the `selector` to `key` parameter rename in doc tools.

If you use the Replace quick action, update the CLI to v0.7.0+ before upgrading the extension.

## Full platform parity for managed install

The managed installer now covers all 8 targets shipped by the CLI. Three new platforms added in this release:

| Target | Use case |
|--------|----------|
| `aarch64-pc-windows-msvc` | Windows ARM64 (Surface Pro X, Snapdragon laptops) |
| `x86_64-unknown-linux-musl` | Alpine dev containers, musl-based CI runners |
| `aarch64-unknown-linux-musl` | Alpine ARM64 dev containers |

Musl detection is automatic: the extension checks for `/lib/ld-musl-<arch>.so.1` and downloads the correct binary. No configuration needed.

## Install or update the CLI

```bash
brew upgrade patchloom                  # Homebrew
cargo install patchloom                 # from source
```

Or run **Patchloom: Update Patchloom** from the VS Code command palette if you use the managed installer.
