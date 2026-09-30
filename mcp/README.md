# MCP Module Map

- `server.mjs` — MCP server factory and guarded tool-to-existing-CLI mapping.
- `tests/mcp-adapter.test.mjs` — source contract tests for delegation, error handling, and no approve/apply shortcut.
- stdio executable: `../bin/debugai-mcp.mjs`.
- detailed contract: `../docs/MCP_ADAPTER.md`.

This module owns only MCP integration. It does not own DebugAI workflow, state, evidence, patch application, or approval logic.
