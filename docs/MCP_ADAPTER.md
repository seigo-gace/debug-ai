# DebugAI MCP Adapter

Status: SOURCE + CI + REAL STDIO PROTOCOL VERIFIED — LIVE DEBUGAI RUNTIME / VS CODEX REGISTRATION NOT YET VERIFIED

## Purpose

Expose the existing DebugAI parent-agent interface through Model Context Protocol without creating a second orchestrator, second workflow, or independent mutation path.

The MCP adapter is transport/integration only:

```text
Parent AI / Codex
  -> DebugAI MCP stdio adapter
  -> existing `bin/debugai.js` execute contract
  -> existing DebugAI HTTP API
  -> existing RunAuthority / durable continuation / workflow / approval gates
```

The MCP adapter therefore does not replace Durable Continuation. It exposes the existing continuation-capable runtime to the parent AI.

## Implementation

- MCP factory: `mcp/server.mjs`
- stdio entry: `bin/debugai-mcp.mjs`
- existing delegated client: `bin/debugai.js`
- unit/contract tests: `mcp/tests/mcp-adapter.test.mjs`
- real stdio protocol regression: `mcp/tests/mcp-stdio.test.mjs`

The adapter is a dedicated ESM entry because the MCP TypeScript SDK v2 is ESM. The existing DebugAI runtime/CLI remains CommonJS and is not converted merely to support MCP.

## Exposed tools

Exactly nine MCP tools are exposed:

- `debugai_health`
- `debugai_analyze`
- `debugai_start`
- `debugai_resume`
- `debugai_wait`
- `debugai_patch_candidate`
- `debugai_verify`
- `debugai_status`
- `debugai_inspect`

The continuation path is available over MCP:

```text
debugai_start
  -> returns exact run_id
  -> debugai_status
  -> debugai_resume when continuation is required
  -> debugai_wait for terminal/blocked state
  -> debugai_inspect for retained/redacted run evidence
```

Run-scoped MCP tools require explicit `run_id`; the MCP surface does not rely on implicit session state for selecting a run.

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

## Current verified source / protocol boundary

Current exact source head before this documentation update:

```text
44f5dcdb6e52e9c0061d732724fc0b4a28ab27b5
```

GitHub Actions for that exact SHA:

```text
Public Readiness Audit #321 = SUCCESS
Verify                 #356 = SUCCESS
Core Verify            #357 = SUCCESS
repository tests            = 355/355 PASS
```

The current Verify run includes MCP contract and real-protocol regressions. It proved:

```text
MCP factory construction     = PASS
MCP surface guarded          = PASS
stdio initialize/handshake   = PASS
tools/list                   = PASS
exact exposed tools          = 9
approve/apply MCP tool       = ABSENT
health tool call             = PASS
```

The real stdio test uses an official MCP client against `bin/debugai-mcp.mjs`. The downstream DebugAI health endpoint is a controlled loopback fixture in CI. This proves the stdio transport -> MCP adapter -> existing CLI/HTTP client boundary without claiming that the Contabo live runtime or VS Codex registration has already been verified.

Historical exact MCP implementation SHA `078203e61073be99a48444ba0c3467a7143102f4` also passed its then-current 286/286 suite and real stdio regression. The current boundary above supersedes it for source/CI status.

## Current state separation

```text
MCP_SOURCE=PASS
MCP_UNIT_CONTRACT=PASS
MCP_STDIO_PROTOCOL=PASS
MCP_TOOLS_9_OF_9=PASS
MCP_DURABLE_CONTINUATION_SURFACE=PASS
MCP_CI=PASS
MCP_LIVE_DEBUGAI_RUNTIME=NOT_VERIFIED
VS_CODEX_MCP_REGISTRATION=NOT_VERIFIED
REAL_SERVER_TOOL_CALLS=NOT_VERIFIED
SERVER_DEPLOY=NOT_EXECUTED
MAIN_MERGE=NOT_EXECUTED
```

Source/CI/stdio protocol PASS is not production/runtime deployment PASS.

## Codex / VS runtime handoff boundary

OpenAI Codex currently supports stdio MCP servers through `mcp_servers.<id>.command`, `args`, and `cwd` in Codex configuration. Codex CLI and the IDE extension share MCP configuration.

For the intended server-side DebugAI checkout, the verified source expects the MCP process to launch from the real checkout and delegate to the loopback DebugAI API:

```text
checkout = /home/admin1/projects/debug-ai
MCP entry = /home/admin1/projects/debug-ai/bin/debugai-mcp.mjs
DebugAI API default = http://127.0.0.1:8787
server workspace = /workspace
```

The exact live Codex registration must be created only after reading the actual server/Codex environment. Do not invent an SSH alias, Windows path, remote-host wrapper, or existing Codex config. If Codex is running in a server/Remote-SSH context, a direct stdio `node .../bin/debugai-mcp.mjs` registration is the intended shape. If Codex is local on Windows, first determine the existing remote execution/SSH arrangement instead of guessing it.

The first real Codex verification should be read-only/continuation-safe:

```text
1. MCP discovery sees exactly the nine DebugAI tools.
2. debugai_health succeeds against the real loopback runtime.
3. Start one bounded diagnostic run with debugai_start and capture its run_id.
4. Read it with debugai_status.
5. Exercise debugai_resume only if the run is actually resumable/interrupted.
6. Use debugai_wait with a bounded timeout.
7. Inspect with debugai_inspect.
8. Do not expose or add approve/apply mutation tools.
```

Server runtime readback, deployment, restart/recreate, and live Search Gate measurement remain outside the source/CI claim and are to be performed by the explicitly authorized VS Codex server-side workflow.

## Workspace registration

Do not register DebugAI as `AVAILABLE_VERIFIED` in server-core/Workspace until the intended runtime is present and a Workspace/Codex MCP host successfully performs discovery and representative calls against that real DebugAI runtime.

Before that point, the correct narrower state is:

```text
SOURCE_CI_STDIO_VERIFIED
LIVE_RUNTIME_NOT_VERIFIED
```

References for current Codex MCP configuration behavior:

- OpenAI Codex configuration reference: https://developers.openai.com/docs/config-file/config-reference
- OpenAI Docs MCP quickstart (Codex CLI/IDE shared configuration): https://developers.openai.com/learn/docs-mcp
