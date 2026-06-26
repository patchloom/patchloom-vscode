# Patchloom for VS Code

This release aligns the extension with [Patchloom CLI v0.6.0](https://github.com/patchloom/patchloom/releases/tag/patchloom-v0.6.0), the biggest CLI release to date: 41 PRs, 112 files changed, and 1,816 tests.

## What's new in the CLI

### 11 AST tools for code-aware agents

The CLI's MCP server now exposes 43 tools (up from 32), with 11 new AST tools powered by tree-sitter:

| Tool | What it does |
|------|-------------|
| `ast_list` | List symbol definitions (functions, classes, structs) across 20 languages |
| `ast_read` | Read a specific symbol's source code by name |
| `ast_rename` | Rename identifiers across files (skips strings and comments) |
| `ast_validate` | Check syntax and report parse errors with line numbers |
| `ast_search` | Structural search using tree-sitter queries and code patterns |
| `ast_refs` | Find all references to a symbol, distinguishing definitions from uses |
| `ast_deps` | Extract import/dependency statements from source files |
| `ast_map` | Generate a ranked repository map using PageRank over the symbol graph |
| `ast_diff` | Structural diff showing added, removed, and modified symbols |
| `ast_impact` | Transitive impact analysis: trace dependents through the reference graph |
| `ast_replace` | Replace text only within a specific symbol's body |

### Declarative MCP tool registry

The MCP server architecture was rebuilt around a declarative registry. Tool schemas are derived directly from Rust types via `schemars`, eliminating schema drift between CLI operations and MCP tools.

### Performance improvements

- **`spawn_blocking` for all sync I/O** on Tokio's blocking thread pool, critical for HTTP/HTTPS transport under concurrent requests
- **Tree-sitter parse tree caching** for repeated AST queries against the same file
- **PageRank convergence** using L1-norm (threshold 1e-6) instead of fixed iterations

### Bug fixes

- `doc flatten` now includes empty arrays and empty objects instead of silently dropping them
- Transaction engine preserves idempotent delete semantics within a plan
- `search --jsonl` with zero matches returns exit code 3 consistently
- `ast_rename` with a no-op rename returns early instead of rewriting files identically
- Git argument injection blocked across all commands that accept paths
- Concurrent-write warnings added to all MCP tool descriptions

## Install or update the CLI

```bash
brew upgrade patchloom           # Homebrew
cargo install patchloom          # crates.io
```

Or run **Patchloom: Update Patchloom** from the VS Code command palette if using the managed installer.
