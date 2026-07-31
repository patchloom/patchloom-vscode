# Configure MCP Server

The Model Context Protocol (MCP) lets AI agents call Patchloom
operations directly: search, replace, tidy, and more.

Click **Configure MCP** above to set up the MCP server configuration
for your editor. Choose the **full** tool inventory or the **core** pack
(sets `PATCHLOOM_MCP_SURFACE=core` for a smaller 11-tool handshake).

## Supported Editors

| Editor | Config file |
|--------|------------|
| VS Code | `.vscode/mcp.json` |
| Cursor | `.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

The command detects which editors are available and configures them
automatically.

See the [MCP setup guide](https://patchloom.github.io/patchloom/getting-started/mcp-setup.html) for advanced configuration.
