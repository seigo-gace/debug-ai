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

GitHub source, CI, AI Core runtime, and live DebugAI Server state are separate facts.

## Current repository state

```text
repository                         = seigo-gace/debug-ai
branch                             = feat/pre-server-benchmark-gates-20261001
PR                                 = #34
PR state                           = OPEN / DRAFT / UNMERGED
base branch                        = feat/search-gate-shadow-audit-cli-20261001
base SHA                           = cfbe2908bb6190bc5f5c894779c4d0f08f51b80e
current source anchor              = 0ad40ea939866c9ae59086c1030aadd3f76bdb4a
```

Exact source qualification observed at `0ad40ea939866c9ae59086c1030aadd3f76bdb4a`:

```text
Public Readiness Audit #380 = SUCCESS
Verify #415                 = SUCCESS
repository tests            = 381/381 PASS
Dependency Review           = SUCCESS
Legacy Authority            = SUCCESS
Runtime Volume Gate #16     = SUCCESS
Core Verify #416            = SUCCESS
pre-server source audit     = source_ready=true / READY
main merge                  = NOT EXECUTED
```

Core Verify includes syntax/source gates, role routing, AI Core request/state/store/governance/repo/run-authority contracts, server behavior, TypeScript 7, real DebugAI image build/health, Sandbox/Landlock/seccomp, managed Node/Python DAP, queue round trip, and Compose boundary checks.

## Current live DebugAI Server boundary

The latest authorized Server reflection currently running is exact source:

```text
checkout path                     = /home/admin1/projects/debug-ai
checkout mode                     = detached HEAD
checkout HEAD                     = ebe48131b236d8ca44057c813236fd0e99925214
.debugai-input/                   = preserved / untracked
runtime-init                      = Exited (0)
sandbox-init                      = Exited (0)
sandbox-runner                    = Up
debug-ai                          = healthy
container entrypoint              = node server/main.js
container workdir                 = /app
loopback /health                  = PASS
tracked worktree                  = CLEAN
pre-server qualification          = source_ready=true / READY
source parity                     = PASS for deployed ebe48131 source
Search Gate shadow                = NO_SHADOW_RECORDS / NOT_EVALUABLE
Search skip activation            = NO
```

The `ebe48131...` reflection preserved `.debugai-input/`, retained persistent volumes, passed Host↔Container source parity for the changed Local Reviewer/Workflow files, and completed with `REFLECTION=PASS`.

The live runtime is healthy for `ebe48131...`. It is now behind current qualified source `0ad40ea...`, so exact Current-source parity is not yet verified.

## AI Core resource incident and closure

The first real Local Reviewer benchmark during this qualification phase timed out at the 600000 ms role deadline. Direct backend and cgroup measurements showed that the previous AI Core memory ceilings were forcing reclaim/throttling during inference even though host memory remained available.

Before correction:

```text
four backend mem_limit        = 6656m each
ai-core.slice MemoryHigh      = 24087M
ai-core.slice MemoryMax       = 28904M
Ministral short speed         = about 0.31 tok/s during constrained state
container/parent max-high hits= observed during tiny inference
```

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

Measured after correction:

```text
Granite short inference       = 7.31 tok/s
Qwen3 short inference         = 5.61 tok/s
Ministral short inference     = 7.45 tok/s
Coder short inference         = 8.05 tok/s
Ministral 128-token retest    = 6.12 tok/s
parent HIGH_DELTA             = 0
parent MAX_DELTA              = 0
OOM_DELTA                     = 0
OOM_KILL_DELTA                = 0
Ministral MAX_DELTA           = 0
host MemAvailable             = about 22 GiB at retest
```

The AI Core memory-pressure cause is closed for the tested serial role path. DebugAI role timeout remains unchanged; timeout extension is not used as a workaround.

## Local Reviewer contract defect sequence

### 1. Noncanonical top-level output

After the AI Core resource correction, one Local Reviewer run returned `ROLE_OUTPUT_JSON_INVALID`. A subsequent RAW capture on the real path produced complete JSON with `finish_reason=stop`, 835 completion tokens, about 6.07 tok/s, but used the noncanonical shape:

```text
review_state
review_evidence
material_claims
final_review_state
```

Production Workflow consumes:

```text
verdict
decision
claims
```

The generic validator had allowed the substitute shape while Production Workflow could read the missing canonical verdict/decision as `UNKNOWN`. Source was therefore changed to require the canonical top-level Local Reviewer fields and fail closed on the substitute schema.

### 2. Canonical claims item type missing in real model output

That top-level repair was documented and reflected to Server at `ebe48131...`. The real Local Reviewer benchmark was then executed three consecutive times on the reflected runtime.

Measured result:

```text
run 1 = FAIL / ROLE_CLAIM_EVIDENCE_INVALID / CLAIM_TYPE_INVALID on claims 0..3
run 2 = FAIL / ROLE_CLAIM_EVIDENCE_INVALID / CLAIM_TYPE_INVALID on claims 0..2
run 3 = FAIL / ROLE_CLAIM_EVIDENCE_INVALID / CLAIM_TYPE_INVALID on claims 0..2
AI Core HIGH delta     = 0 on every run
AI Core MAX delta      = 0 on every run
AI Core OOM delta      = 0 on every run
AI Core OOM_KILL delta = 0 on every run
```

This is repeatable schema-contract failure, not renewed AI Core resource pressure and not an intermittent JSON parse failure.

`claim-evidence.js` already requires each `claims[]` item to use one of the canonical claim types:

```text
FACT
INFERENCE
HYPOTHESIS
UNKNOWN
REJECTED
```

The real prompt previously required a `claims` array but did not explicitly name the `type` field or enumerate its allowed values. Unit fixtures manually supplied `type:"FACT"`, so the gap was not exposed by the earlier unit path.

## Current Local Reviewer claim-type repair

Current source `0ad40ea939866c9ae59086c1030aadd3f76bdb4a` keeps the validator strict and changes the invocation contract instead of accepting malformed output.

The current prompt explicitly requires:

- top-level `verdict`, `decision`, `claims`;
- every `claims[]` item has required `type`;
- `type` is uppercase and exactly one of `FACT`, `INFERENCE`, `HYPOTHESIS`, `UNKNOWN`, `REJECTED`;
- concise text uses `statement`;
- `FACT` / `INFERENCE` require registered `evidence_refs`;
- `HYPOTHESIS` requires `falsification_condition`;
- `REJECTED` requires `counter_evidence_refs`;
- `UNKNOWN` may remain unsupported rather than fabricate evidence;
- `INSUFFICIENT_EVIDENCE` remains a valid verdict/decision state but is not a claim type;
- `claim`, `status`, `support`, `review_state`, `final_review_state`, and `material_claims` cannot substitute for canonical fields.

Regression coverage now includes the real failure family: a claim object using `claim/evidence_refs/support` but omitting canonical `type` must be rejected with `CLAIM_TYPE_INVALID`.

The validator was not weakened. Existing `UNKNOWN and INSUFFICIENT_EVIDENCE are valid` non-fabrication policy was also preserved after CI caught its accidental removal during the first edit attempt.

Exact source qualification for this repair is the `0ad40ea...` CI set recorded above.

## Runtime-image and Server-local input contract

Current runtime-image contract includes `server/`, `orchestrator/`, `bin/`, `mcp/`, `scripts/`, `docs/`, and `package.json`.

The Server-local `.debugai-input/` path is excluded from Docker build context and must not be deleted by source reflection.

Production Compose retains:

- `runtime-init` one-shot ownership/mode repair for `debug_ai_runtime`;
- `sandbox-init` for sandbox job storage;
- `debug-ai` waiting for successful initialization;
- `sandbox-runner` isolated from external network;
- no deletion/recreation of persistent runtime volume merely to make deployment clean.

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
- six-role Skill ON/OFF suite;
- one-variable Model A/B harness for `thinking`, `temperature`, `top_p`, `top_k`, `max_tokens`;
- exact source/runtime live-readback gate;
- runtime-image qualification/MCP asset packaging;
- production named-volume initialization contract.

## Current qualification state

```text
SERVER_CORE_AUTHORITY_READ              = PASS
AI_CORE_RESOURCE_GATE                   = PASS
AI_CORE_SPEED_RECOVERED                 = PASS
CURRENT_SOURCE_HEAD                     = 0ad40ea939866c9ae59086c1030aadd3f76bdb4a
CURRENT_SOURCE_CI                       = PASS
LIVE_SERVER_HEAD                        = ebe48131b236d8ca44057c813236fd0e99925214
LIVE_SERVER_HEALTH                      = PASS
LIVE_SERVER_SOURCE_PARITY_FOR_EBE       = PASS
CURRENT_RUNTIME_EXACT_PARITY_FOR_0AD    = NOT_VERIFIED
LOCAL_REVIEWER_REAL_ON_EBE              = FAIL_CLAIM_TYPE_INVALID_3_OF_3
LOCAL_REVIEWER_CLAIM_TYPE_FIX_SOURCE    = PASS
LOCAL_REVIEWER_CLAIM_TYPE_FIX_REFLECTED = NO
SKILL_EFFECT_ALL_REAL                   = NOT_EXECUTED
MODEL_AB_THINKING_REAL                  = NOT_EXECUTED
MODEL_AB_SAMPLING_REAL                  = NOT_EXECUTED
MODEL_AB_TOKEN_CAP_REAL                 = NOT_EXECUTED
REAL_INTEGRATION_E2E                    = NOT_EXECUTED
MCP_LIVE                                = NOT_VERIFIED
VS_CODEX_MCP_REGISTRATION               = NOT_VERIFIED
SEARCH_GATE_SHADOW_REAL                 = NOT_EVALUABLE_NO_RECORDS
FALSE_SKIP_ZERO_PROVEN                  = NO
SEARCH_SKIP_ACTIVATION                  = NO
FRESH_CURRENT_RUNTIME_SELF_DEBUG        = NOT_EXECUTED
FINAL_PRODUCTION_EQUIVALENT_E2E         = NOT_EXECUTED
MAIN_MERGE                              = NO
PRODUCTION_PROFILE_CHANGE               = NONE
```

A source/unit/CI PASS does not convert the real Local Reviewer gate to PASS. The claim-type repair must first be reflected to Server and measured through the real model path.

## Master authorization boundary

Master authorized Current DebugAI Server source reflection/build/recreate after README/document synchronization. That authorization does not include PR/main merge, destructive reset, `.debugai-input/` deletion, runtime-volume deletion, Secret/provider changes, new model downloads, Search Gate skip activation, production profile promotion, or unrelated project mutation.

Master separately authorized the AI Core resource change recorded above. That does not authorize unrelated AI Core model/provider changes.

## Required next-work order

```text
1. synchronize README / CURRENT_STATE / PRE_SERVER_QUALIFICATION to the 0ad40ea source and measured ebe48131 runtime
2. require exact documentation-following HEAD CI PASS
3. preserve .debugai-input and reflect that exact confirmed GitHub revision to /home/admin1/projects/debug-ai
4. rebuild/recreate only required DebugAI Compose services without deleting persistent volumes
5. prove runtime-init/sandbox-init, DebugAI health, port 8787, tracked cleanliness, and exact source parity
6. rerun pre-server/live-runtime gates where executable and preserve NOT_EXECUTED where not
7. rerun Local Reviewer real benchmark three times and require canonical verdict/decision/claims plus valid claims[].type
8. only after stable Local Reviewer PASS, run six-role Skill ON/OFF real suite
9. run one-variable Model A/B: Thinking where eligible -> Sampling -> token cap only when justified
10. run bounded real allowed-repository integration
11. verify MCP exact nine tools + durable continuation
12. accumulate/evaluate Search Gate real shadow without activation
13. run fresh current-runtime self-debug
14. run final production-equivalent closed-loop E2E
15. update current-state docs and Notion from measured results
```

Every unexecuted, failed, or not-yet-reflected item keeps that state until real evidence changes it.
