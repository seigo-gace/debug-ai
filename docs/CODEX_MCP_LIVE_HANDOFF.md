# VS Codex -> DebugAI MCP Live Verification Handoff

## Purpose

This document starts **after** DebugAI source/CI/stdio MCP verification is complete and covers only the live VS Codex verification boundary.

It does not authorize deployment, restart, pull, reset, merge, or production mutation.

## Current source-side expectation

DebugAI MCP is an stdio adapter:

```text
VS Codex / parent AI
  -> bin/debugai-mcp.mjs
  -> mcp/server.mjs
  -> bin/debugai.js
  -> http://127.0.0.1:8787
  -> existing DebugAI runtime/workflow
```

Expected MCP surface: exactly nine tools.

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

No approve/apply MCP shortcut is allowed.

## Known server-side paths / defaults

Previously recorded live checkout:

```text
/home/admin1/projects/debug-ai
```

MCP entry:

```text
/home/admin1/projects/debug-ai/bin/debugai-mcp.mjs
```

Default delegated DebugAI API:

```text
http://127.0.0.1:8787
```

Container workspace root:

```text
/workspace
```

Compose binds the configured host workspace root into `/workspace`.

## Codex configuration rule

Use the actual Codex execution context. Do not guess it.

OpenAI Codex supports stdio MCP configuration through `mcp_servers.<id>.command`, `args`, and `cwd`; CLI and IDE extension share MCP configuration.

If Codex is actually running in the server/Remote-SSH environment, the intended registration shape is:

```toml
[mcp_servers.debugai]
command = "node"
args = ["/home/admin1/projects/debug-ai/bin/debugai-mcp.mjs"]
cwd = "/home/admin1/projects/debug-ai"

[mcp_servers.debugai.env]
DEBUGAI_URL = "http://127.0.0.1:8787"
DEBUGAI_WORKSPACE_HOST_PATH = "/home/admin1/projects"
DEBUGAI_SERVER_WORKSPACE_ROOT = "/workspace"
```

Do **not** install this block blindly. First read the real active Codex config and confirm that Codex is executing on the server side / Remote-SSH side.

If Codex is running locally on Windows instead, do not invent an SSH alias or remote wrapper. Read the existing Codex/SSH arrangement first, then configure the stdio launch through the already-authorized remote execution path.

## Required preflight — read only

From `/home/admin1/projects/debug-ai`, read and report only:

```text
pwd
git remote get-url origin
git branch --show-current
git rev-parse HEAD
git diff --quiet --no-ext-diff -- <tracked-only state>
git diff --cached --quiet --no-ext-diff -- <index state>
docker ps filtered to the Compose debug-ai service
curl loopback /health
```

Prefer the repository-provided gate when the live checkout already contains it:

```bash
npm run audit:live-runtime
```

That command is designed as a read-only gate. It must not deploy/restart/sync the server. If source/runtime is behind or incompatible, report `RUNTIME_SOURCE_BEHIND_OR_UNKNOWN` and stop the live measurement path.

## MCP live verification sequence

Only after the live runtime is present and the MCP server can be registered without server mutation:

1. Confirm Codex discovers exactly the nine DebugAI tools.
2. Call `debugai_health`.
3. Create one bounded diagnostic run with `debugai_start` against an explicitly allowed repository path.
4. Capture the exact returned `run_id`.
5. Call `debugai_status` with that exact `run_id`.
6. Call `debugai_resume` only if the run is actually interrupted/resumable. Do not manufacture a resume need.
7. Call `debugai_wait` with a bounded timeout.
8. Call `debugai_inspect` and confirm retained/redacted evidence is readable.
9. Optionally call read-only `debugai_verify` on an explicitly allowed repository.
10. Do not call or create an approve/apply shortcut.

## Durable continuation proof

The live check is not complete merely because `health` works.

For the MCP continuation boundary, capture evidence that:

```text
start -> run_id
same run_id -> status
same run_id -> resume when applicable
same run_id -> wait
same run_id -> inspect
```

The purpose is to prove that the parent AI can continue a DebugAI job across multiple MCP calls instead of treating one LLM/tool invocation as the whole debugging job.

## Pass / fail states

Use these exact states in the report:

```text
MCP_TOOL_DISCOVERY=PASS|FAIL
MCP_HEALTH=PASS|FAIL
MCP_DURABLE_START=PASS|FAIL|NOT_EXECUTED
MCP_STATUS=PASS|FAIL|NOT_EXECUTED
MCP_RESUME=PASS|FAIL|NOT_APPLICABLE|NOT_EXECUTED
MCP_WAIT=PASS|FAIL|NOT_EXECUTED
MCP_INSPECT=PASS|FAIL|NOT_EXECUTED
MCP_VERIFY=PASS|FAIL|NOT_EXECUTED
MCP_APPROVE_APPLY_SHORTCUT=ABSENT|PRESENT_INVALID
LIVE_RUNTIME_SOURCE_STATE=EXACT_COMPATIBLE|RUNTIME_SOURCE_BEHIND_OR_UNKNOWN
SERVER_MUTATION=NONE|UNAUTHORIZED_CHANGE_DETECTED
```

Do not report `AVAILABLE_VERIFIED` unless representative real-runtime calls pass.

## Hard prohibitions

Without explicit Master authorization, do not:

- `git pull`, `git reset`, force checkout, branch rewrite, or merge;
- deploy, rebuild, recreate, restart, or stop DebugAI containers/services;
- change `.env`, secrets, API keys, Cloudflare, TGserver, AI Core, Astera, or server-core;
- expose port 8787 publicly;
- create an MCP approve/apply tool;
- modify production data merely to make a verification pass.

If the live runtime is older than the source under verification, report the mismatch and stop. Sync/deploy is a separate explicitly authorized phase.

## Source references

- `docs/MCP_ADAPTER.md`
- `mcp/server.mjs`
- `bin/debugai-mcp.mjs`
- `bin/debugai.js`
- `compose.yaml`
- `scripts/live-runtime-readback.cjs`

Current Codex MCP configuration references:

- https://developers.openai.com/docs/config-file/config-reference
- https://developers.openai.com/learn/docs-mcp
