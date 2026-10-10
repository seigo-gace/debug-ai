# DebugAI external parent-agent entry points

DebugAI can be called from VS Code, Cursor, Codex, ChatGPT-driven terminal work, or another parent developer agent through the CLI, HTTP API, and guarded MCP stdio adapter. These are integration layers only; workflow/state/evidence/approval/mutation authority remains in the DebugAI runtime.

Read [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) before making a current runtime claim.

## Runtime and endpoint

Repository Node authority:

```text
24.20.0
```

Default API:

```text
http://127.0.0.1:8787
```

The production container sees repositories below `/workspace`. Use the actual configured workspace mapping; do not invent a local/server path mapping.

## CLI entry

Repository form:

```bash
npm run debugai -- health
```

Linked form:

```bash
npm link
debugai health
```

`DEBUGAI_URL` defaults to the loopback API above.

## CLI commands

```text
health
analyze
start
resume
wait
patch
verify
status
inspect
server-command <request|status> --input-json <service-contract-json>
gitops <request|status> --input-json <service-contract-json>
```

Examples:

```bash
debugai health
debugai analyze "OAuth callback後に/loginへ戻る原因を調査"
debugai start "対象不具合を根拠付きで調査"
debugai status <run-id>
debugai resume <run-id>
debugai wait <run-id>
debugai inspect <run-id>
debugai patch "確認済み原因に対する最小修正" --paths src/example.ts
debugai verify --repo /workspace/my-repo --paths src/example.ts
```

`patch` creates a candidate only. It does not apply it. `verify` is read-only.

Run-scoped continuation must reuse the exact returned `run_id`; do not create a second run merely to simulate continuation.

## CLI output contract

- stdout is one machine-readable JSON document;
- human summary is stderr and may be suppressed with `--no-summary`;
- `verify` exits `0` only for `PASS`;
- `FAIL`, `UNKNOWN`, and `INSUFFICIENT_EVIDENCE` retain JSON and use a non-zero verdict exit;
- CLI/HTTP failures use the formal CLI error schema;
- never place Secrets, tokens, cookies, Authorization headers, or `.env` values in CLI arguments.

## MCP adapter

Repository entry:

```bash
npm run debugai:mcp
```

Linked entry:

```bash
debugai-mcp
```

The MCP server uses stdio. stdout is protocol traffic; operational startup text belongs on stderr.

Thirteen tools are exposed; the original nine remain available:

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
debugai_server_read
debugai_server_status
debugai_gitops_request
debugai_gitops_status
```

There is intentionally no MCP approve/apply tool.

MCP delegates to the existing CLI/HTTP execution contract and does not create a second orchestrator or state engine.

## Current verified integration boundary

Implementation anchor before the current documentation synchronization:

```text
source anchor                = c2355f8dd7628e717db1bba83725b33360796828
repository tests             = 373/373 PASS
Public Readiness Audit       = #359 SUCCESS
Verify                       = #394 SUCCESS
Core Verify                  = #395 SUCCESS
MCP stdio handshake          = PASS
MCP tools/list               = PASS / exact 9
MCP health fixture call      = PASS
runtime-image MCP assets     = PASS
approve/apply MCP shortcut   = ABSENT
```

This proves source/CI/protocol packaging. It does not prove live Contabo MCP calls.

Current separation:

```text
MCP_SOURCE=PASS
MCP_STDIO_PROTOCOL=PASS
MCP_TOOLS_9_OF_9=PASS
MCP_RUNTIME_IMAGE_ASSETS=PASS
MCP_LIVE_DEBUGAI_RUNTIME=NOT_VERIFIED
VS_CODEX_MCP_REGISTRATION=NOT_VERIFIED
CURRENT_SOURCE_SERVER_REFLECTION=NOT_EXECUTED
```

The last real Server readback found a healthy older Runtime at `df261bdae...`; the Current qualification/MCP assets were absent from that running old image. See [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md).

## External parent-agent workflow

```text
start/analyze
-> capture exact run_id/evidence
-> status
-> resume only when actually resumable
-> bounded wait
-> inspect
-> candidate only if confirmed defect requires one
-> explicit approval outside CLI/MCP shortcut surface
-> deterministic verification
-> authoritative status/evidence
```

The integration layer must never bypass evidence, repository revision, approval, review, or Strict Completion gates.

## MCP live verification

Use [`docs/MCP_ADAPTER.md`](docs/MCP_ADAPTER.md) and [`docs/CODEX_MCP_LIVE_HANDOFF.md`](docs/CODEX_MCP_LIVE_HANDOFF.md).

Representative live proof requires:

```text
tool discovery exact 9
-> debugai_health
-> debugai_start
-> exact run_id status
-> resume only if applicable
-> bounded wait
-> inspect
```

Do not mark MCP `AVAILABLE_VERIFIED` from source/CI alone.

## Repository verification

```bash
npm run verify
```

Current source also provides:

```bash
npm run audit:pre-server-qualification
npm run audit:live-runtime
```

Both preserve source/runtime separation; neither silently authorizes mutation.

## Bounded control commands

Use structured service-contract JSON and the exact server-visible repo path:

```bash
debugai server-command request --input-json '{"command_id":"project.pwd","repo":"/workspace/debug-ai","arguments":[]}'
debugai server-command status --input-json '{"id":"<returned-command-id>"}'
debugai gitops status --input-json '{"repo":"/workspace/debug-ai","id":"<returned-gitops-id>"}'
```

`gitops request --input-json <json>` passes the existing `GitOpsRequestService.request()` contract unchanged. Publish requires explicit approval, expected HEAD, branch, candidate identity, selected files and commit message; deploy retains the exact SHA and separate Host approval gate. The CLI does not infer or grant approval. These commands do not write continuation session state. See [`docs/MCP_ADAPTER.md`](docs/MCP_ADAPTER.md) for exact MCP/CLI/HTTP mappings and source/runtime boundaries.
