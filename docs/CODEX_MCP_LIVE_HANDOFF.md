# VS Codex -> DebugAI MCP Live Verification Handoff

## Purpose

This document starts **after** DebugAI source/CI/stdio MCP verification is complete and covers the live VS Codex verification boundary.

It does not authorize deployment, restart, pull, reset, merge, production mutation, Search Gate activation, or automatic model-profile promotion.

Before using this handoff, read `docs/PRE_SERVER_QUALIFICATION.md`. Source readiness and real Server measurements are separate facts.

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

Prefer the repository-provided gates when the live checkout already contains them:

```bash
npm run audit:pre-server-qualification
npm run audit:live-runtime
```

`audit:pre-server-qualification` proves only that the expected source-side benchmark/MCP/live-readback harnesses are present and internally coherent. It deliberately reports all real measurements as not executed.

`audit:live-runtime` is a read-only live-source/runtime gate. It must not deploy/restart/sync the server. If source/runtime is behind or incompatible, report `RUNTIME_SOURCE_BEHIND_OR_UNKNOWN` and stop the live measurement path.

## Required real benchmark phase

Only after the live runtime is already source-compatible may Codex run real-model qualification.

### Local Reviewer

```bash
npm run benchmark:local-reviewer
```

Do not replace this with a unit-test result.

### Six-role Skill ON/OFF

```bash
npm run benchmark:skill-effect-all
```

Report the measured result exactly. `SKILL_OFF` or `TIE` is valid evidence and must not be rewritten as a Skill-ON PASS.

The suite must cover all six roles. If any role is missing or fails to measure, report `INCOMPLETE`.

### Model A/B

Use `docs/PRE_SERVER_QUALIFICATION.md` and change one axis at a time:

```bash
npm run benchmark:model-ab -- \
  --role <role> \
  --axis <thinking|temperature|max_tokens> \
  --candidate <explicit-value> \
  --repeats <1..5>
```

The harness keeps the backend model, fixed benchmark case, input, and Skill-ON system constant inside each pair.

A real measurement may report:

```text
QUALITY_REGRESSION
NO_QUALITY_GAIN
QUALITY_IMPROVEMENT_MEASURED
```

Even an improvement is measurement only. Do not change production role/model profiles merely because the benchmark measured a gain.

## Real integration boundary

After the benchmark phase, execute one bounded real DebugAI run against an explicitly allowed repository and preserve actual use/non-use of:

```text
AI Core
TGserver search/retrieval when the run requires it
Astera Evidence Search when the run requires it
Durable continuation
current repository/runtime evidence
```

Do not manufacture TGserver/Evidence Search traffic solely to mark them PASS. If a provider is not applicable to the chosen run, report that accurately and use a separate representative case if its real path must be qualified.

Unknown or insufficient evidence must remain unknown/insufficient. Do not fabricate support to force a complete run.

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

## Search Gate shadow measurement

Only after `audit:live-runtime` proves source/runtime compatibility may Codex inspect the real read-only Shadow Audit result.

Preserve these distinctions:

```text
no candidate skips       != false-skip zero
NOT_EVALUABLE            != ZERO_OBSERVED
shadow measurement       != activation authority
```

Do not activate search skipping from this audit.

## Pass / fail states

Use these exact states in the report:

```text
PRE_SERVER_HARNESS_SOURCE=PASS|FAIL
LOCAL_REVIEWER_REAL=PASS|FAIL|NOT_EXECUTED
SKILL_EFFECT_ALL_REAL=PASS|FAIL|INCOMPLETE|NOT_EXECUTED
MODEL_AB_REAL=MEASURED|INCOMPLETE|NOT_EXECUTED
REAL_INTEGRATION_E2E=PASS|FAIL|NOT_EXECUTED
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
SEARCH_GATE_SHADOW_REAL=MEASURED|NOT_EVALUABLE|NOT_EXECUTED
PRODUCTION_PROFILE_CHANGE=NONE|MASTER_AUTHORIZED
SERVER_MUTATION=NONE|MASTER_AUTHORIZED
```

Do not report `AVAILABLE_VERIFIED` unless representative real-runtime calls pass.

## Hard prohibitions

Without explicit Master authorization, do not:

- `git pull`, `git reset`, force checkout, branch rewrite, or merge;
- deploy, rebuild, recreate, restart, or stop DebugAI containers/services;
- change `.env`, secrets, API keys, Cloudflare, TGserver, AI Core, Astera, or server-core;
- expose port 8787 publicly;
- create an MCP approve/apply tool;
- change production model/profile settings merely because one A/B measurement looked better;
- modify production data merely to make a verification pass.

If the live runtime is older than the source under verification, report the mismatch and stop. Sync/deploy is a separate explicitly authorized phase.

## Source references

- `docs/PRE_SERVER_QUALIFICATION.md`
- `docs/MCP_ADAPTER.md`
- `mcp/server.mjs`
- `bin/debugai-mcp.mjs`
- `bin/debugai.js`
- `server/control/skill-effect-suite.js`
- `server/control/model-ab-benchmark.js`
- `scripts/pre-server-qualification-audit.cjs`
- `compose.yaml`
- `scripts/live-runtime-readback.cjs`

Current Codex MCP configuration references:

- https://developers.openai.com/docs/config-file/config-reference
- https://developers.openai.com/learn/docs-mcp
