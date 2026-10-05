# DebugAI MCP Adapter

Status: **SOURCE + CI + REAL STDIO PROTOCOL + SOURCE DURABLE-CONTINUATION CONTRACT + RUNTIME-IMAGE ASSET CONTRACT VERIFIED; LIVE CURRENT-RUNTIME CALLS NOT YET VERIFIED**

Read [`CURRENT_STATE.md`](CURRENT_STATE.md) for the exact current repository/runtime boundary.

## Purpose

Expose the existing DebugAI parent-agent interface through Model Context Protocol without creating a second orchestrator, workflow, state engine, or mutation path.

```text
Parent AI / Codex
  -> bin/debugai-mcp.mjs
  -> mcp/server.mjs
  -> existing bin/debugai.js execute contract
  -> http://127.0.0.1:8787
  -> existing DebugAI RunAuthority/workflow/approval gates
```

MCP is transport/integration only.

## Implementation

- factory: `mcp/server.mjs`
- stdio entry: `bin/debugai-mcp.mjs`
- delegated client: `bin/debugai.js`
- adapter contract tests: `mcp/tests/mcp-adapter.test.mjs`
- durable-continuation source contract: `mcp/tests/mcp-durable-continuation.test.mjs`
- real stdio protocol regression: `mcp/tests/mcp-stdio.test.mjs`

The MCP entry is ESM because the MCP SDK is ESM; the existing runtime/CLI remains CommonJS where already designed.

## Exact tool surface

Exactly nine tools:

```text
debugai_health
debugai_analyze
debugai_start
debugai_resume
debugai_wait
debugai_patch_candidate
debugai_verify
debugai_status
debugai_inspect
```

No approve/apply shortcut is allowed.

Run-scoped tools require explicit `run_id`. Repository-scoped operations require an explicit repository path.

## Durable continuation surface

```text
debugai_start
-> returns exact run_id
-> debugai_status
-> debugai_resume only when the run is actually resumable/interrupted
-> bounded debugai_wait
-> debugai_inspect
```

The adapter does not own continuation state; it delegates to the existing runtime. The source regression now locks this as one explicit-run chain: the same caller-supplied/returned `run_id` must be forwarded through status/resume/wait/inspect, execution errors stay fail-closed, and the MCP adapter does not synthesize replacement run identity.

## Mutation boundary

`debugai_patch_candidate` creates a candidate only.

Patch application remains behind the established approval boundary:

```text
explicit Master approval
+ exact candidate identity
+ repository revision validation
+ apply receipt
+ deterministic retest
+ reviews
+ Strict Completion
```

MCP must not weaken or bypass this contract.

## Output

Successful tools return MCP text containing `debugai.mcp-result/v1` JSON. Transport/delegated execution failures return `isError=true` with the MCP error schema. A DebugAI verdict other than PASS is not rewritten into transport PASS semantics.

## Dependencies

```text
@modelcontextprotocol/server 2.2.0
@modelcontextprotocol/client 2.2.0 (test only)
zod 4.6.5
Node 24.20.0
```

## Current verified source/protocol boundary

Behavior/test anchor before this documentation synchronization:

```text
source anchor                    = 0cee91391fd86075b1bf8b9a0412946c3c562b5b
Verify #562 / run 37258254053  = SUCCESS
repository tests                 = 436/436 PASS / 0 FAIL / 0 SKIP
pre-server source_ready          = true
MCP factory                      = PASS
MCP stdio initialize/handshake   = PASS
tools/list                       = PASS
exact exposed tools              = 9
health fixture call              = PASS
durable continuation mapping     = PASS
durable explicit run-id chain    = PASS
durable error fail-closed        = PASS
approve/apply MCP tool           = ABSENT
runtime-image MCP assets         = PASS
```

The stdio regression uses an official MCP client against the real MCP entry with a controlled loopback HTTP fixture. The durable-continuation regression delegates through the same existing `execute` contract and proves explicit source-level start/status/resume/wait/inspect routing. These prove source/protocol behavior, not live Contabo Current-runtime operation.

## Runtime-image contract

The Current Docker runtime source explicitly packages `bin/`, `mcp/`, `scripts/`, and `docs/` needed for live MCP/qualification. A regression test protects that packaging contract.

A healthy older image does not prove the current source MCP contract is live. Current exact-source deployment/readback remains a separate state and approval boundary.

## Current state separation

```text
MCP_SOURCE=PASS
MCP_UNIT_CONTRACT=PASS
MCP_STDIO_PROTOCOL=PASS
MCP_TOOLS_9_OF_9=PASS
MCP_DURABLE_CONTINUATION_SOURCE_CHAIN=PASS
MCP_RUNTIME_IMAGE_ASSETS=PASS
MCP_LIVE_DEBUGAI_RUNTIME=NOT_VERIFIED
VS_CODEX_MCP_REGISTRATION=NOT_VERIFIED
REAL_SERVER_TOOL_CALLS=NOT_VERIFIED
CURRENT_SOURCE_SERVER_REFLECTION=NOT_EXECUTED
MAIN_MERGE=NOT_EXECUTED
```

## Server/Codex execution context

Known intended live checkout:

```text
/home/admin1/projects/debug-ai
```

MCP entry:

```text
/home/admin1/projects/debug-ai/bin/debugai-mcp.mjs
```

Delegated API:

```text
http://127.0.0.1:8787
```

Container repository root:

```text
/workspace
```

Do not invent an SSH alias, Windows wrapper, or Codex config. Read the actual execution context first.

## Representative live proof

After Current source/runtime parity is proven:

```text
1. discover exactly nine tools
2. debugai_health
3. debugai_start on an explicitly allowed repository
4. capture exact run_id
5. debugai_status with that run_id
6. debugai_resume only if actually applicable
7. bounded debugai_wait
8. debugai_inspect
9. optional read-only debugai_verify
10. confirm no approve/apply MCP shortcut exists
```

Do not mark Workspace MCP `AVAILABLE_VERIFIED` before representative real-runtime calls pass.

## References

- `README.md`
- `CURRENT_STATE.md`
- `PRE_SERVER_QUALIFICATION.md`
- `CODEX_MCP_LIVE_HANDOFF.md`
- `../DEBUGAI.md`
