# Patchloom for VS Code 0.11.0

This release follows Patchloom CLI 0.37.11. Quick Actions for INI and YAML use the assignments and quoting from that CLI.

## Highlights

Recommended CLI is now **0.37.11**. The minimum is still **0.3.0**. No settings migration is required.

Configure MCP still offers 66 tools, or a 12-tool core pack.

## CLI 0.37.11

These show up when the extension runs the recommended CLI ([#337](https://github.com/patchloom/patchloom-vscode/pull/337)).

- **An INI line `port: 5432` is a setting.** The key is `port` and the value is `5432`. Set structured value keeps the separator already on that line. A new key is written with `=`. A line that is not a setting, a comment, or a section header is a parse error and the file stays unchanged.
- **An empty INI section stays in the file.** Editing another section does not drop `[defaults]` when it has no keys. A root key stays above the first section. Spaces inside the brackets are not part of the name (`[ database ]` is `database`). Updating a key rewrites every copy of that key in the same section.
- **A dotted INI name reads the key that already exists.** `database.server.port` reads the key `server.port` in section `database` when that key is present. If it is not, the same path reads key `port` in a section named `database.server`. When both exist, the key `server.port` is the one you get. A path that matches neither reports no match and does not write.
- **A YAML value with brackets stays text.** `item[2020-01-01]` is not rewritten when you set another key. A value that starts with `[` is still a list, so a date inside that list is quoted.
- **A compact YAML flow key stays one key.** `{1:30:t}` is the key `1:30:t`. `{1:30: t}` is the key `1:30` and the value `t`.
- **A whole base-2 token is quoted.** Set structured value writes `0b0` and `0b10` with double quotes (`flag: "0b10"`). A sentence that only contains `0b10` stays as you typed it.

## Numbers

| Metric | Previous | Current |
|--------|----------|---------|
| Extension version | 0.10.0 | 0.11.0 |
| Recommended CLI | 0.37.10 (minimum still 0.3.0) | 0.37.11 (minimum still 0.3.0) |
| MCP tools (CLI full / core) | 66 / 12 | 66 / 12 |

## Upgrading

1. Update the extension to **0.11.0** (VS Code Marketplace, Open VSX, or `.vsix` from the GitHub Release).
2. Update the Patchloom CLI using the channel that matches how the extension resolved it (see **Patchloom: Show Status**, Source):

```bash
# Managed install (extension storage): command palette
# Patchloom: Update Patchloom

# PATH via Scoop (preferred Windows PATH channel)
scoop update patchloom

# PATH via Homebrew
brew upgrade patchloom

# npm / cargo / shell installer: see README Install section
```

3. Confirm with **Patchloom: Show Status** that the detected CLI is **0.37.11** or newer (0.3.0+ still runs; 0.37.11 is recommended).
4. Optional: set `patchloom.mcpSurface` to `full` or `core`, then run **Patchloom: Configure MCP**.

## Install

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=patchloom.patchloom)
- [Open VSX](https://open-vsx.org/extension/patchloom/patchloom)
- GitHub Release assets: `patchloom.vsix` and build provenance (`patchloom.vsix.intoto.jsonl`)

## Full changelog

https://github.com/patchloom/patchloom-vscode/compare/patchloom-v0.10.0...patchloom-v0.11.0
