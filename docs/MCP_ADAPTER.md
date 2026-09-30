# DebugAI MCP Adapter

Status: SOURCE + CI STDIO PROTOCOL VERIFIED — LIVE DEBUGAI RUNTIME NOT DEPLOYED / NOT VERIFIED

## Purpose

Expose the existing DebugAI parent-agent interface through Model Context Protocol without creating a second orchestrator, second workflow, or independent mutation path.

The MCP adapter is transport/integration only:

```text
MCP Host
  -> DebugAI MCP stdio adapter
  -> existing `bin/debugai.js` execute contract
  -> existing DebugAI HTTP API
  -> existing RunAuthority / workflow / approval gates
```

## Implementation

- MCP factory: `mcp/server.mjs`
- stdio entry: `bin/debugai-mcp.mjs`
- existing delegated client: `bin/debugai.js`
- unit/contract tests: `mcp/tests/mcp-adapter.test.mjs`
- real stdio protocol regression: `mcp/tests/mcp-stdio.test.mjs`

The adapter is a dedicated ESM entry because the MCP TypeScript SDK v2 is ESM. The existing DebugAI runtime/CLI remains CommonJS and is not converted merely to support MCP.

## Exposed tools

- `debugai_health`
- `debugai_analyze`
- `debugai_start`
- `debugai_resume`
- `debugai_wait`
- `debugai_patch_candidate`
- `debugai_verify`
- `debugai_status`
- `debugai_inspect`

Run-scoped MCP tools require explicit `run_id`; the MCP surface does not depend on implicit CLI session state for selecting a run.

Repository-scoped analysis/verification requires an explicit `repo` path to avoid accidentally acting on the MCP process working directory.

## Mutation / approval boundary

The MCP surface intentionally does **not** expose an approve/apply shortcut.

`debugai_patch_candidate` creates a candidate only. Patch application remains behind the existing explicit approval decision, exact candidate identity binding, repository revision validation, apply receipt, retest, review, and Strict Completion path.

Do not add a mutation-capable MCP tool unless the existing approval contract can be preserved end-to-end and separately verified.

## Output

Successful tools return an MCP text result containing JSON with:

```text
schema = debugai.mcp-result/v1
tool
exit_code
result
```

Adapter/delegated execution failures return `isError=true` with `debugai.mcp-error/v1`.

A DebugAI verification verdict other than PASS remains a valid DebugAI result and is not converted into a fabricated MCP transport success claim.

## Dependencies

- `@modelcontextprotocol/server` 2.2.0
- `@modelcontextprotocol/client` 2.2.0 (protocol regression test only)
- `zod` 4.6.5

Node runtime remains the repository authority version.

## Verified source / protocol boundary

Exact implementation SHA verified before this documentation-only update:

```text
078203e61073be99a48444ba0c3467a7143102f4
```

GitHub Actions for that exact SHA:

```text
Verify                 = SUCCESS
Public Readiness Audit = SUCCESS
Core Verify            = SUCCESS
```

`Verify` executed the complete repository suite with:

```text
tests = 286
pass  = 286
fail  = 0
```

The MCP-specific real-protocol regression executed an official MCP client over stdio and verified:

```text
stdio initialize/handshake = PASS
tools/list                 = PASS
exact exposed tools        = 9
approve/apply tool absent  = PASS
debugai_health tool call   = PASS
```

The health call used a controlled loopback HTTP fixture as the downstream DebugAI endpoint. This proves the MCP stdio transport -> adapter -> existing CLI/HTTP client boundary without claiming a Contabo/live DebugAI deployment.

## Current state separation

```text
MCP_SOURCE=PASS
MCP_UNIT_CONTRACT=PASS
MCP_STDIO_PROTOCOL=PASS
MCP_CI=PASS
MCP_LIVE_DEBUGAI_RUNTIME=NOT_VERIFIED
WORKSPACE_REGISTRATION=NOT_EXECUTED
SERVER_DEPLOY=NOT_EXECUTED
MAIN_MERGE=NOT_EXECUTED
```

Source/CI/stdio protocol PASS is not production/runtime deployment PASS.

## Workspace registration

Do not register DebugAI as `AVAILABLE_VERIFIED` in server-core/Workspace until the intended runtime is deployed and a Workspace MCP host successfully performs discovery and representative calls against that real DebugAI runtime.

Before that point, server-core may record the narrower state `SOURCE_CI_STDIO_VERIFIED / LIVE_RUNTIME_NOT_VERIFIED` if useful for discovery.
