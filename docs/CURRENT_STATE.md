# DebugAI Current Verified State

This document is the current-state companion to `README.md` and the design authority. It records the latest verified implementation/runtime boundary without rewriting historical design decisions.

## Authority separation

```text
Design / architecture              = docs/DURABLE-CONTINUATION-DESIGN.md
Current implementation/runtime     = this document
CLI / parent-agent usage           = DEBUGAI.md
MCP transport contract             = docs/MCP_ADAPTER.md
Qualification contract             = docs/PRE_SERVER_QUALIFICATION.md
Live MCP handoff                   = docs/CODEX_MCP_LIVE_HANDOFF.md
Server/VPS/Docker operations       = current G-ACE-inc/server-core authority
```

GitHub source, exact-head CI, shared AI Core runtime, live DebugAI Server state, and production state are separate facts. No older report promotes an unverified current state.

## Current repository state

```text
repository                         = seigo-gace/debug-ai
branch                             = feat/pre-server-benchmark-gates-20261001
PR                                 = #34
PR state                           = OPEN / DRAFT / UNMERGED
base branch                        = feat/search-gate-shadow-audit-cli-20261001
base SHA                           = cfbe2908bb6190bc5f5c894779c4d0f08f51b80e
current source HEAD                = 9dc8def709ab277bbfb1e6b6701821791bf4dcd8
current source purpose             = resumable six-role Skill ON/OFF measurement
```

Exact-head qualification observed at `9dc8def709ab277bbfb1e6b6701821791bf4dcd8`:

```text
Public Readiness Audit #384 = SUCCESS
Verify #419                 = SUCCESS
Dependency Review           = SUCCESS
Legacy Authority            = SUCCESS
Runtime Volume Gate #20     = SUCCESS
Core Verify #420            = SUCCESS
pre-server source audit     = READY
main merge                  = NOT EXECUTED
```

The exact-head source adds a resumable Skill-effect measurement layer without changing the six role benchmark cases, scorers, models, Skill ON/OFF semantics, production profiles, Search Gate state, providers, or secrets.

## Resumable Skill-effect source contract

The previous `benchmark:skill-effect-all` path executed every real model call serially and only emitted a generic external heartbeat while the suite itself had no durable per-call progress/checkpoint state. Six roles currently require 44 real AI calls in total and each role client retains its 600000 ms per-call timeout ceiling. That made a long run operationally opaque and made interruption discard completed work.

Current source `9dc8def...` routes the six-role measurement through `server/control/resumable-skill-effect-suite.js`.

The new source contract:

- preserves the existing six role benchmark cases and scoring;
- preserves Skill OFF wins and ties as valid measurement results;
- reports progress by `role -> case -> OFF/ON` rather than generic liveness only;
- checkpoints each completed OFF/ON unit immediately;
- writes checkpoint state atomically;
- resumes completed units instead of paying for the same real inference twice;
- binds checkpoint reuse to a source fingerprint and fails closed when incompatible source is detected;
- does not grant production promotion authority.

The resumable source is CI-qualified but is not yet the live Server runtime.

## Current live DebugAI Server boundary

Fresh readback after aborting the old long-running Skill suite confirmed:

```text
checkout path                     = /home/admin1/projects/debug-ai
checkout mode                     = detached HEAD
checkout HEAD                     = 4c7e7273424d097fc4bfb60a727824c944ef374b
.debugai-input/                   = PRESENT / PRESERVE
tracked worktree                  = CLEAN
runtime-init                      = Exited / exit=0
sandbox-init                      = Exited / exit=0
sandbox-runner                    = running / exit=0
debug-ai                          = running / healthy / exit=0
loopback /health                  = PASS
old Skill benchmark process count = 0
latest old temp log               = /tmp/debugai-skill.KgKjtd.json
latest old temp log bytes         = 0
Search skip activation            = NO
```

Therefore the old Skill benchmark is no longer running and left no reusable result payload. The current live runtime is healthy at `4c7e727...` but is behind source `9dc8def...`.

```text
CURRENT_RUNTIME_EXACT_PARITY_FOR_9DC8DEF = NOT_VERIFIED
```

No current claim treats source CI PASS as proof that the resumable runner is deployed.

## AI Core resource incident and closure

The first real Local Reviewer benchmark during this qualification phase timed out at the 600000 ms role deadline. Direct backend and cgroup measurements showed that the previous AI Core memory ceilings were forcing reclaim/throttling during inference even though host memory remained available.

Master authorized the shared AI Core resource correction. Current measured authority is:

```text
four backend mem_limit        = 9216m each
ai-core.slice MemoryHigh      = 34G
ai-core.slice MemoryMax       = 36G
--cache-ram                   = 4096 unchanged
context                       = 8192 unchanged
backend CPU                   = 3 unchanged
models/router                 = unchanged
```

Measured recovery included approximately Granite 7.31 tok/s, Qwen3 5.61 tok/s, Ministral 7.45 tok/s, Coder 8.05 tok/s, and a 128-token Ministral retest near 6.12 tok/s. The final tested serial path produced zero new parent High/Max/OOM/OOM-kill events. DebugAI role timeout was not extended as a workaround.

## Local Reviewer defect history and closure

The Local Reviewer qualification history has distinct causes and must not be collapsed.

1. An early real run timed out while AI Core was under severe memory reclaim pressure.
2. After the authorized AI Core resource correction, one run returned `ROLE_OUTPUT_JSON_INVALID`.
3. A RAW capture returned complete JSON but noncanonical top-level `review_state/material_claims` instead of `verdict/decision/claims`.
4. Source was tightened to require canonical top-level output.
5. Real measurement on the then-live runtime produced three consecutive `CLAIM_TYPE_INVALID` failures because the model output omitted/invalidly represented canonical `claims[].type`.
6. The validator remained strict. The invocation contract was repaired to explicitly require `type = FACT | INFERENCE | HYPOTHESIS | UNKNOWN | REJECTED` and the corresponding evidence/falsification/counter-evidence rules.
7. That fixed source was reflected to Server revision `4c7e7273424d097fc4bfb60a727824c944ef374b` and measured three consecutive times through the real role path.

Current measured Local Reviewer result on `4c7e727...`:

```text
run 1: RC=0 / completed=true / elapsed_ms=161769
       contract.validated=true / strict_evidence_refs=true
       verdict=PASS / decision=DONE / claims_count=3 / claim_types=[FACT]
       AI Core HIGH/MAX/OOM/OOM_KILL delta=0/0/0/0

run 2: RC=0 / completed=true / elapsed_ms=55456
       contract.validated=true / strict_evidence_refs=true
       verdict=PASS / decision=DONE / claims_count=3 / claim_types=[FACT]
       AI Core HIGH/MAX/OOM/OOM_KILL delta=0/0/0/0

run 3: RC=0 / completed=true / elapsed_ms=54017
       contract.validated=true / strict_evidence_refs=true
       verdict=PASS / decision=DONE / claims_count=3 / claim_types=[FACT]
       AI Core HIGH/MAX/OOM/OOM_KILL delta=0/0/0/0

FINAL_OK=1
```

The Local Reviewer canonical output defect is closed for this fixed-source serial benchmark path. This is not evidence that every workflow/concurrency/integration path is complete.

## Old six-role Skill measurement attempt

After Local Reviewer closure, the six-role Skill ON/OFF real suite was started on live `4c7e727...`.

Observed behavior:

- heartbeat output continued for more than 30 minutes;
- the wrapper exposed only `HEARTBEAT=skill-suite-running` and no role/case/OFF-ON position;
- the old suite did not checkpoint completed real calls;
- Master interrupted the run;
- a subsequent process-targeting command found no remaining suite process;
- fresh readback confirmed `SKILL_BENCHMARK_PROCESS_COUNT=0`;
- the latest old temp result file is zero bytes.

Therefore the attempt has no valid reusable benchmark result and must not be labeled PASS or complete.

```text
SKILL_EFFECT_ALL_REAL = INCOMPLETE / ABORTED_OLD_NONRESUMABLE_RUN
```

Do not infer any role winner from the aborted run.

## Current implementation capabilities

Implemented/verified source boundary includes:

- six fixed internal roles through shared AI Core;
- role-specific Skill procedures and bounded Tool Runtime;
- deterministic evidence registry and claim/evidence binding;
- canonical Local Reviewer top-level and claim-item output enforcement;
- Evidence Projection / Active Evidence Window;
- durable RunAuthority, native writer lock, generation/epoch fencing;
- durable read-only effect reuse and Researcher continuation;
- patch/review packets and exact approval/revision/application boundaries;
- Strict Completion Gate;
- runtime evidence retention/archive/GC safety;
- guarded CLI/HTTP surface;
- exact nine-tool MCP stdio adapter;
- Search Gate provider-preserving shadow instrumentation/audit;
- Local Reviewer benchmark;
- six-role Skill ON/OFF benchmark definitions;
- resumable/checkpointed six-role Skill measurement orchestration in current source;
- one-variable Model A/B harness for `thinking`, `temperature`, `top_p`, `top_k`, `max_tokens`;
- exact source/runtime live-readback gate;
- runtime-image qualification/MCP asset packaging;
- production named-volume initialization contract.

## Current qualification state

```text
SERVER_CORE_AUTHORITY_READ                 = PASS
AI_CORE_RESOURCE_GATE                      = PASS
AI_CORE_SPEED_RECOVERED                    = PASS
CURRENT_SOURCE_HEAD                        = 9dc8def709ab277bbfb1e6b6701821791bf4dcd8
CURRENT_SOURCE_CI                          = PASS
LIVE_SERVER_HEAD                           = 4c7e7273424d097fc4bfb60a727824c944ef374b
LIVE_SERVER_HEALTH                         = PASS
LIVE_SERVER_TRACKED_WORKTREE               = CLEAN
DEBUGAI_INPUT                              = PRESENT / PRESERVE
OLD_SKILL_BENCHMARK_PROCESS_COUNT          = 0
OLD_SKILL_BENCHMARK_RESULT                 = NONE / ZERO_BYTE_LOG
CURRENT_RUNTIME_EXACT_PARITY_FOR_9DC8DEF   = NOT_VERIFIED
LOCAL_REVIEWER_CANONICAL_REAL              = PASS_3_OF_3_ON_4C7E727
AI_CORE_RESOURCE_PATH                      = PASS_FOR_TESTED_SERIAL_PATH
SKILL_EFFECT_ALL_REAL                      = INCOMPLETE_ABORTED_OLD_NONRESUMABLE_RUN
RESUMABLE_SKILL_SUITE_SOURCE_CI            = PASS
RESUMABLE_SKILL_SUITE_LIVE                 = NOT_VERIFIED
MODEL_AB_THINKING_REAL                     = NOT_EXECUTED
MODEL_AB_SAMPLING_REAL                     = NOT_EXECUTED
MODEL_AB_TOKEN_CAP_REAL                    = NOT_EXECUTED
REAL_INTEGRATION_E2E                       = NOT_EXECUTED
MCP_LIVE                                   = NOT_VERIFIED
VS_CODEX_MCP_REGISTRATION                  = NOT_VERIFIED
SEARCH_GATE_SHADOW_REAL                    = NOT_EVALUABLE_NO_RECORDS
FALSE_SKIP_ZERO_PROVEN                     = NO
SEARCH_SKIP_ACTIVATION                     = NO
FRESH_CURRENT_RUNTIME_SELF_DEBUG           = NOT_EXECUTED
FINAL_PRODUCTION_EQUIVALENT_E2E            = NOT_EXECUTED
MAIN_MERGE                                 = NO
PRODUCTION_PROFILE_CHANGE                  = NONE
```

## Mutation and approval boundary

No result above authorizes PR/main merge, force/rebase/reset, branch deletion, destructive runtime state deletion, `.debugai-input/` deletion, persistent volume deletion, Search Gate activation, production model/profile promotion, Secret/provider mutation, or a new model download.

Source-side documentation and feature-branch corrections may proceed independently. Reflecting current source `9dc8def...` into the live Server is a separate runtime mutation and remains subject to the current server-core authority and explicit Master authorization for that current mutation.

## Required next-work order

```text
1. synchronize README / CURRENT_STATE / PRE_SERVER_QUALIFICATION to current Source=9dc8def and live Runtime=4c7e727
2. require exact documentation-following HEAD CI PASS
3. keep Server at 4c7e727 until current-source reflection is explicitly authorized under server-core
4. when authorized, preserve .debugai-input and persistent volumes and reflect the exact confirmed GitHub revision
5. rebuild/recreate only the required DebugAI services and prove init/health/worktree/exact source parity
6. run the resumable six-role Skill ON/OFF real measurement; reuse checkpoints after interruption rather than restarting completed units
7. interpret Skill OFF wins and ties as valid data; do not tune the benchmark to force Skill ON
8. run Thinking A/B only for roles with explicit boolean thinking contracts
9. run official-first Sampling A/B
10. run token-cap A/B only if preceding evidence justifies a candidate
11. run bounded real allowed-repository integration
12. verify MCP exact-nine tools plus durable continuation
13. accumulate/evaluate Search Gate shadow read-only; do not activate skipping
14. run fresh current-runtime self-debug
15. run final production-equivalent closed-loop E2E
16. update current-state docs and Notion only from measured evidence
```

Every unexecuted, failed, incomplete, or not-yet-reflected item keeps that state until real evidence changes it.
