# DebugAI MCP Adapter

Status: SOURCE IMPLEMENTATION — RUNTIME HANDSHAKE NOT YET VERIFIED

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
- tests: `mcp/tests/mcp-adapter.test.mjs`

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
- `zod` 4.6.5

Node runtime remains the repository authority version.

## Verification boundary

Source-level verification requires:
- syntax check for MCP `.mjs` files;
- adapter mapping tests;
- no approve/apply tool exposure;
- delegated `execute()` call verification;
- error fail-closed behavior;
- MCP server factory construction;
- full existing repository verification / CI regression.

Source/CI PASS is not runtime MCP PASS.

Runtime MCP availability additionally requires an actual host/stdio handshake, tool discovery, and at least representative tool calls against the intended DebugAI runtime. Until that closes, report:

```text
MCP_SOURCE=IMPLEMENTED
MCP_CI=PASS only when exact-SHA CI passes
MCP_RUNTIME=NOT_VERIFIED
WORKSPACE_REGISTRATION=NOT_EXECUTED
```

## Workspace registration

Do not register DebugAI as `AVAILABLE_VERIFIED` in server-core/Workspace merely because these files exist. Update the Workspace registry only after source/CI and actual MCP runtime verification are complete.
