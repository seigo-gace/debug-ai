# DebugAI Pre-Server Qualification

## Purpose

Separate source-complete measurement logic from real Server/model/runtime measurements. Source readiness must never be relabeled as a live PASS.

Read [`CURRENT_STATE.md`](CURRENT_STATE.md) for the current source/runtime boundary.

Server/VPS/Docker mutation is governed by current `G-ACE-inc/server-core` authority plus explicit Master authorization.

## Current source qualification anchor

Current source HEAD:

```text
9dc8def709ab277bbfb1e6b6701821791bf4dcd8
```

Purpose of the current source anchor:

```text
resumable/checkpointed six-role Skill ON/OFF measurement
```

Exact-head qualification observed at that anchor:

```text
Public Readiness Audit #384      = SUCCESS
Verify #419                      = SUCCESS
Dependency Review                = SUCCESS
Legacy Authority                 = SUCCESS
Runtime Volume Gate #20          = SUCCESS
Core Verify #420                 = SUCCESS
pre-server source audit          = source_ready=true / READY
main merge                       = NOT EXECUTED
```

The source audit deliberately reports real model/integration/MCP/Search measurements separately. Source/CI PASS does not promote an unreflected, aborted, incomplete, or failed real benchmark to PASS.

Documentation commits following this anchor require their own exact-head CI before Server reflection.

## Current live precondition

Fresh live readback after stopping the old long-running Skill suite:

```text
Server checkout                  = 4c7e7273424d097fc4bfb60a727824c944ef374b
Runtime                          = running / healthy / exit=0
runtime-init                     = exited / exit=0
sandbox-init                     = exited / exit=0
sandbox-runner                   = running / exit=0
loopback /health                 = PASS
tracked worktree                 = CLEAN
.debugai-input                   = PRESENT / PRESERVE
old Skill suite process count    = 0
latest old result log            = /tmp/debugai-skill.KgKjtd.json
latest old result log bytes      = 0
Current 9dc8def source           = not reflected
LIVE_RUNTIME_SOURCE_STATE        = RUNTIME_SOURCE_BEHIND_OR_UNKNOWN for current HEAD
Search Gate shadow               = NO_SHADOW_RECORDS / NOT_EVALUABLE
Search skip activation           = NO
```

The live runtime is healthy for `4c7e727...`. That does not prove current-source parity for `9dc8def...`.

```text
CURRENT_RUNTIME_EXACT_PARITY_FOR_9DC8DEF = NOT_VERIFIED
```

Reflecting current source to Server is a separate runtime mutation and remains governed by server-core and current explicit Master authorization.

## AI Core resource gate

AI Core resource pressure was independently diagnosed and corrected with Master authorization. Current measured authority remains:

```text
four backend mem_limit        = 9216m each
ai-core.slice MemoryHigh      = 34G
ai-core.slice MemoryMax       = 36G
--cache-ram                   = 4096 unchanged
context                       = 8192 unchanged
backend CPU                   = 3 unchanged
models/router                 = unchanged
```

Measured recovery included approximately Granite 7.31 tok/s, Qwen3 5.61 tok/s, Ministral 7.45 tok/s, Coder 8.05 tok/s, and a 128-token Ministral retest near 6.12 tok/s. The final tested serial path produced zero new High/Max/OOM/OOM-kill events. DebugAI timeout was not extended as a workaround.

## Source-side qualification order

Repository source must provide deterministic runners for:

1. exact-head repository verification/CI;
2. Local Reviewer real-role benchmark;
3. six-role Skill ON/OFF suite;
4. resumable/checkpointed six-role measurement orchestration;
5. one-variable Model A/B harness;
6. exact live source/runtime readback;
7. MCP durable-continuation handoff;
8. Search Gate read-only shadow assessment.

`npm run verify` executes build/check/tests plus the source qualification audit.

## Pre-server source audit

```bash
npm run audit:pre-server-qualification
```

Required source checks include:

```text
local_reviewer_runner
six_role_skill_suite
model_ab_runner
model_ab_sampling_scope
model_ab_official_candidates
mcp_exact_nine_tools
required_scripts
required_docs
```

A result of `source_ready=true` means only that the entry points/contracts exist and are coherent.

## Local Reviewer canonical contract gate

The real Local Reviewer path is not qualified merely because the model returns parseable JSON.

Canonical top-level output required by current source is:

```text
verdict
decision
claims
```

Every `claims[]` item must also use the canonical reasoning-artifact contract:

```text
type = FACT | INFERENCE | HYPOTHESIS | UNKNOWN | REJECTED
statement = concise claim text
```

Additional rules:

- `FACT` and `INFERENCE` require one or more registered `evidence_refs`;
- `HYPOTHESIS` requires `falsification_condition`;
- `REJECTED` requires `counter_evidence_refs`;
- `UNKNOWN` may remain unsupported rather than invent evidence;
- `INSUFFICIENT_EVIDENCE` is a valid verdict/decision state, not a claim type;
- `review_state`, `final_review_state`, `material_claims`, `claim`, `status`, or `support` do not substitute for the canonical fields.

The validator remains fail-closed. The repair changed the invocation contract so the real model receives the same schema the validator already enforces.

## Measured Local Reviewer history

### AI Core constrained state

An early real Local Reviewer run timed out at 600000 ms while AI Core memory ceilings caused severe backend reclaim. After the authorized resource correction, inference speed recovered and cgroup High/Max/OOM deltas returned to zero for the tested serial path.

This timeout cause is closed and the DebugAI timeout remains unchanged.

### Noncanonical top-level output

After resource correction, one run returned `ROLE_OUTPUT_JSON_INVALID`. A RAW recapture produced complete JSON but used `review_state/review_evidence/material_claims/final_review_state` instead of the Production Workflow canonical `verdict/decision/claims` contract. Source was tightened rather than validation being weakened.

### Repeatable claim-type failure

A subsequent reflected runtime produced three consecutive `CLAIM_TYPE_INVALID` failures because the real prompt did not explicitly require canonical `claims[].type`. The validator already required the field; unit fixtures had hidden the real-model gap by manually supplying `type:"FACT"`.

### Fixed-source real closure on 4c7e727

The prompt contract was corrected while retaining strict validation and the non-fabrication boundary. Source was reflected to Server revision:

```text
4c7e7273424d097fc4bfb60a727824c944ef374b
```

The canonical Local Reviewer benchmark then passed three consecutive real executions:

```text
run 1 = RC=0 / completed=true / contract.validated=true / strict_evidence_refs=true
        verdict=PASS / decision=DONE / claims_count=3 / claim_types=[FACT]
        elapsed_ms=161769 / AI Core HIGH/MAX/OOM/OOM_KILL delta=0/0/0/0

run 2 = RC=0 / completed=true / contract.validated=true / strict_evidence_refs=true
        verdict=PASS / decision=DONE / claims_count=3 / claim_types=[FACT]
        elapsed_ms=55456 / AI Core HIGH/MAX/OOM/OOM_KILL delta=0/0/0/0

run 3 = RC=0 / completed=true / contract.validated=true / strict_evidence_refs=true
        verdict=PASS / decision=DONE / claims_count=3 / claim_types=[FACT]
        elapsed_ms=54017 / AI Core HIGH/MAX/OOM/OOM_KILL delta=0/0/0/0

FINAL_OK=1
```

Therefore:

```text
LOCAL_REVIEWER_REAL_CURRENT_RUNTIME = PASS_3_OF_3_ON_4C7E727
LOCAL_REVIEWER_CANONICAL_CONTRACT   = PASS_FOR_TESTED_SERIAL_PATH
```

Do not broaden that result to unmeasured concurrency/workflow/integration paths.

## Live runtime readback

```bash
npm run audit:live-runtime
```

This is read-only. It verifies repository identity, bounded Git state, production entrypoint/workdir, exact Host↔Container measurement-source parity, DebugAI health identity, and safe preconditions for read-only Search Gate shadow evaluation.

If source/runtime is incompatible, preserve:

```text
LIVE_RUNTIME_SOURCE_STATE=RUNTIME_SOURCE_BEHIND_OR_UNKNOWN
```

Do not invent a live measurement.

## Six-role Skill ON/OFF suite

Current script:

```bash
npm run benchmark:skill-effect-all
```

Fixed role order remains:

```text
code_scout
causal_scout
researcher
diagnoser
patch_engineer
local_reviewer
```

The six role benchmark definitions currently require 44 real AI calls in total. Each role benchmark retains its own fixed cases/scorer and OFF/ON pairing.

Rules:

- same role/model/fixed cases;
- Skill ON is not assumed better;
- Skill OFF wins and ties are valid;
- one missing/failing role makes the suite incomplete;
- no production promotion authority;
- do not tune benchmark cases or scoring to force Skill ON to win.

### Aborted old non-resumable attempt

The old live path on `4c7e727...` was started after Local Reviewer closure. The wrapper emitted generic `HEARTBEAT=skill-suite-running` for more than 30 minutes without exposing current role/case/OFF-ON position. The old suite did not checkpoint completed model calls.

Master interrupted the run. Fresh readback later confirmed:

```text
SKILL_BENCHMARK_PROCESS_COUNT = 0
LATEST_OLD_LOG                = /tmp/debugai-skill.KgKjtd.json
LATEST_OLD_LOG_BYTES          = 0
```

Therefore the old run has no valid result payload and is classified:

```text
SKILL_EFFECT_ALL_REAL = INCOMPLETE / ABORTED_OLD_NONRESUMABLE_RUN
```

No role winner may be inferred from it.

### Current resumable source behavior

Current source `9dc8def...` preserves the existing role benchmark logic but adds resumable orchestration:

- progress at `role -> case -> OFF/ON` granularity;
- heartbeat during each real model call;
- atomic checkpoint after each completed OFF/ON unit;
- resume from compatible checkpoints;
- no repeat charge for already completed compatible units;
- source-fingerprint binding;
- fail-closed checkpoint rejection after incompatible source change;
- no production promotion authority.

The resumable source is CI-qualified but not yet reflected to live Server. Do not rerun the six-role real suite until the exact resumable source is reflected and live parity is proven.

## Model A/B

Design order:

```text
Thinking
-> Sampling
-> Token cap
```

Supported explicit axes:

```text
thinking
temperature
top_p
top_k
max_tokens
```

Each pair fixes the same backend model, fixed benchmark case, input, and Skill-ON system while changing exactly one axis and counterbalancing execution order.

A role with `thinking=null` is not eligible for fabricated Thinking A/B.

### Official-first candidates

| Role | Temperature | top_p | top_k |
| --- | ---: | ---: | ---: |
| code_scout | 0.7 | 0.8 | 20 |
| causal_scout | 0.7 | 0.8 | 20 |
| researcher | 1.0 | 0.95 | no fixed official candidate |
| diagnoser | 0.6 | 0.95 | 20 |
| patch_engineer | 0.7 | 0.8 | 20 |
| local_reviewer | 0.7 | 0.95 | no fixed official candidate |

`--candidate official` must fail closed when no current model-bound candidate exists.

A recommendation is a measurement candidate, not automatic production configuration.

### Token cap

Do not invent a lower cap before prior real measurements are available. Test one explicit candidate at a time and retain a smaller cap only when quality does not regress and measured cost/latency improvement is real.

### Result authority

```text
QUALITY_REGRESSION
NO_QUALITY_GAIN
QUALITY_IMPROVEMENT_MEASURED
```

Every result remains:

```text
promotion_authorized=false
```

## Real integration qualification

After exact current runtime parity and completed Skill/Model measurements as required:

```text
AI Core real calls
TGserver real path when the chosen case requires it
Astera Evidence Search real path when the chosen case requires it
real allowed repository
Durable continuation
MCP parent-agent path
Search Gate shadow evidence
```

Do not manufacture provider traffic solely to mark a box PASS.

## Required live order from the current boundary

```text
current server-core authority
-> exact documentation-following source CI PASS
-> explicit authorization for current Server reflection
-> preserve .debugai-input and persistent volumes
-> exact confirmed GitHub revision reflection
-> rebuild/recreate only required DebugAI services
-> /health + init states + worktree + exact source parity
-> resumable six-role Skill ON/OFF real measurement
-> Thinking A/B only where explicit boolean
-> official-first Sampling A/B
-> token-cap A/B only after prior evidence
-> real allowed-repository integration
-> MCP durable continuation proof
-> Search Gate shadow measurement, read-only
-> fresh self-debug case
-> final production-equivalent closed-loop E2E
```

## Completion states

```text
SERVER_CORE_AUTHORITY_READ=PASS|FAIL
CURRENT_SOURCE_SERVER_REFLECTION=PASS|FAIL|NOT_EXECUTED
CURRENT_RUNTIME_EXACT_PARITY=PASS|FAIL|NOT_VERIFIED
PRE_SERVER_HARNESS_SOURCE=PASS|FAIL
LOCAL_REVIEWER_REAL=PASS|FAIL|NOT_EXECUTED
LOCAL_REVIEWER_TOP_LEVEL_CONTRACT=PASS|FAIL|NOT_VERIFIED
LOCAL_REVIEWER_CLAIM_TYPE_CONTRACT=PASS|FAIL|NOT_VERIFIED
SKILL_EFFECT_ALL_REAL=PASS|FAIL|INCOMPLETE|NOT_EXECUTED
RESUMABLE_SKILL_SUITE_LIVE=PASS|FAIL|NOT_VERIFIED
MODEL_AB_THINKING_REAL=MEASURED|PARTIAL|NOT_APPLICABLE|NOT_EXECUTED
MODEL_AB_SAMPLING_REAL=MEASURED|PARTIAL|INCOMPLETE|NOT_EXECUTED
MODEL_AB_TOKEN_CAP_REAL=MEASURED|INCOMPLETE|NOT_EXECUTED
REAL_INTEGRATION_E2E=PASS|FAIL|NOT_EXECUTED
MCP_LIVE=PASS|FAIL|NOT_EXECUTED
SEARCH_GATE_SHADOW_REAL=MEASURED|NOT_EVALUABLE|NOT_EXECUTED
PRODUCTION_PROFILE_CHANGE=NONE|MASTER_AUTHORIZED
SEARCH_SKIP_ACTIVATION=NO|MASTER_AUTHORIZED
```

No fixture/source audit may promote an unexecuted, aborted, incomplete, or failed real state to PASS.
