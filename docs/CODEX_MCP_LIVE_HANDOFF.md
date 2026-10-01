# VS Codex / Parent AI -> DebugAI MCP Live Verification Handoff

## Purpose

Define the live parent-agent verification path after source/CI/MCP protocol verification. Read [`CURRENT_STATE.md`](CURRENT_STATE.md) first.

This document does not itself authorize main merge, Secret changes, Search Gate activation, production model/profile promotion, or unrelated Server mutations.

Master has separately authorized the Current DebugAI source-reflection/build/recreate phase after the current README/document synchronization. Current server-core remains the Server-operation authority.

## Current known boundary

Source implementation anchor before documentation synchronization:

```text
c2355f8dd7628e717db1bba83725b33360796828
```

Source/CI:

```text
Public Readiness #359 = SUCCESS
Verify #394           = SUCCESS
Tests                 = 373/373 PASS
Core Verify #395      = SUCCESS
MCP exact 9 tools     = PASS
runtime-image assets  = PASS
```

Last read-only Server state:

```text
checkout              = /home/admin1/projects/debug-ai
Server HEAD           = df261bdae3b6f259ac428a173b798fae2fb68bdf
old Runtime           = healthy
entrypoint            = node server/main.js
workdir               = /app
container Node        = v24.20.0
health                = PASS
Current assets        = absent from old image
Current source live   = RUNTIME_SOURCE_BEHIND_OR_UNKNOWN
```

## Required authority before mutation

At execution time read the current `G-ACE-inc/server-core` authority required for an authorized deploy/runtime mutation. Do not reuse an old server-core SHA as current authority.

Preserve local-only Server state. In particular, `.debugai-input/` is untracked Server-local state and must not be deleted merely to make the checkout clean.

## Current authorized source-reflection phase

The authorized scope is limited to bringing the existing DebugAI Server checkout/runtime onto the exact Current DebugAI source required for qualification, then proving health/parity.

Required invariants:

```text
no force reset of unknown local-only material
no .debugai-input deletion
no Secret change
no provider-resource change
no new model download
no main merge implied
no Search Gate activation
no production profile promotion
```

After reflection/build/recreate, prove the actual running runtime before any real-model/MCP claim.

## MCP architecture

```text
Parent AI / Codex
  -> bin/debugai-mcp.mjs
  -> mcp/server.mjs
  -> bin/debugai.js
  -> http://127.0.0.1:8787
  -> existing DebugAI RunAuthority/workflow
```

Expected tools:

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

No approve/apply MCP shortcut is valid.

## Known paths

```text
checkout             = /home/admin1/projects/debug-ai
MCP entry            = /home/admin1/projects/debug-ai/bin/debugai-mcp.mjs
DebugAI API          = http://127.0.0.1:8787
container workspace  = /workspace
```

Do not invent a Codex execution context. Read the actual active environment/config before registration.

## Qualification sequence after exact runtime parity

### 1. Source/runtime gates

```text
audit:pre-server-qualification
audit:live-runtime
```

Both must be interpreted according to `PRE_SERVER_QUALIFICATION.md`.

### 2. Local Reviewer

```text
benchmark:local-reviewer
```

Use the real current AI Core path.

### 3. Six-role Skill ON/OFF

```text
benchmark:skill-effect-all
```

Report Skill OFF wins/ties exactly. All six roles must measure or the suite is incomplete.

### 4. Model A/B

Axes:

```text
thinking
temperature
top_p
top_k
max_tokens
```

Change one axis only. Keep model/case/input/Skill system fixed. Use official candidates only where recorded. Do not fabricate Thinking state or candidate values. Measurement never promotes production configuration automatically.

### 5. Real integration case

Use an explicitly allowed real repository. Preserve actual use/non-use and actual errors for:

```text
AI Core
TGserver when applicable
Astera Evidence Search when applicable
Durable continuation
repository/runtime evidence
```

Do not manufacture provider traffic.

## MCP live sequence

```text
1. discover exactly nine tools
2. debugai_health
3. debugai_start on an allowed repository
4. capture exact run_id
5. debugai_status with same run_id
6. debugai_resume only if the run is genuinely resumable/interrupted
7. bounded debugai_wait
8. debugai_inspect
9. optional read-only debugai_verify
10. confirm no approve/apply shortcut
```

Health alone is insufficient. Durable continuation must be proven across multiple calls using the same run ID.

## Search Gate shadow

Only inspect the real shadow result after exact compatible runtime source is proven.

Preserve:

```text
no candidate skips != false-skip zero
NOT_EVALUABLE      != ZERO_OBSERVED
shadow measurement != activation authority
```

Do not activate search skipping from the shadow audit alone.

## Live result states

```text
CURRENT_SOURCE_SERVER_REFLECTION=PASS|FAIL|NOT_EXECUTED
CURRENT_RUNTIME_EXACT_PARITY=PASS|FAIL|NOT_VERIFIED
PRE_SERVER_HARNESS_SOURCE=PASS|FAIL
LOCAL_REVIEWER_REAL=PASS|FAIL|NOT_EXECUTED
SKILL_EFFECT_ALL_REAL=PASS|FAIL|INCOMPLETE|NOT_EXECUTED
MODEL_AB_THINKING_REAL=MEASURED|PARTIAL|NOT_APPLICABLE|NOT_EXECUTED
MODEL_AB_SAMPLING_REAL=MEASURED|PARTIAL|INCOMPLETE|NOT_EXECUTED
MODEL_AB_TOKEN_CAP_REAL=MEASURED|INCOMPLETE|NOT_EXECUTED
REAL_INTEGRATION_E2E=PASS|FAIL|NOT_EXECUTED
MCP_TOOL_DISCOVERY=PASS|FAIL|NOT_EXECUTED
MCP_HEALTH=PASS|FAIL|NOT_EXECUTED
MCP_DURABLE_START=PASS|FAIL|NOT_EXECUTED
MCP_STATUS=PASS|FAIL|NOT_EXECUTED
MCP_RESUME=PASS|FAIL|NOT_APPLICABLE|NOT_EXECUTED
MCP_WAIT=PASS|FAIL|NOT_EXECUTED
MCP_INSPECT=PASS|FAIL|NOT_EXECUTED
MCP_VERIFY=PASS|FAIL|NOT_EXECUTED
MCP_APPROVE_APPLY_SHORTCUT=ABSENT|PRESENT_INVALID
SEARCH_GATE_SHADOW_REAL=MEASURED|NOT_EVALUABLE|NOT_EXECUTED
PRODUCTION_PROFILE_CHANGE=NONE|MASTER_AUTHORIZED
SEARCH_SKIP_ACTIVATION=NO|MASTER_AUTHORIZED
```

Do not report `AVAILABLE_VERIFIED` until representative live-runtime calls pass.

## References

- `../README.md`
- `CURRENT_STATE.md`
- `DURABLE-CONTINUATION-DESIGN.md`
- `PRE_SERVER_QUALIFICATION.md`
- `MCP_ADAPTER.md`
- `../DEBUGAI.md`
