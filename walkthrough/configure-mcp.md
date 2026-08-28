# Configure MCP Server

The Model Context Protocol (MCP) lets AI agents call Patchloom
operations directly: search, replace, tidy, and more.

Click **Configure MCP** above to set up the MCP server configuration
for your editor. Choose the **full** tool inventory or the **core** pack
(sets `PATCHLOOM_MCP_SURFACE=core` for a smaller 11-tool handshake).

## Supported Editors

| Editor | Config file | Key |
|--------|-------------|-----|
| VS Code | `.vscode/mcp.json` | `servers` |
| Cursor | `.cursor/mcp.json` | `mcpServers` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | `mcpServers` |

The command lists the editors it can configure. You pick one or more
targets, then Full vs Core. It does not write every editor on its own.

See the [MCP setup guide](https://patchloom.github.io/patchloom/getting-started/mcp-setup.html) for advanced configuration.
