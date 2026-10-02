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
Local Reviewer contract fix anchor = 6f2882fcd05d141f7392ede635dbb31ee15289fb
```

Exact source qualification at `6f2882fcd05d141f7392ede635dbb31ee15289fb`:

```text
Public Readiness Audit #373 = SUCCESS
Verify #408                 = SUCCESS
repository tests            = 380/380 PASS
Dependency Review           = SUCCESS
Legacy Authority            = SUCCESS
Runtime Volume Gate #9      = SUCCESS
Core Verify #409            = SUCCESS
pre-server source audit     = source_ready=true / READY
main merge                  = NOT EXECUTED
```

Core Verify includes syntax/source gates, role routing, AI Core request/state/store/governance/repo/run-authority contracts, server behavior, TypeScript 7, real DebugAI image build/health, Sandbox/Landlock/seccomp, managed Node/Python DAP, queue round trip, and Compose boundary checks.

## Current live DebugAI Server boundary

The previously authorized source reflection recovered the production runtime to exact source `56e1059f20cf0604a7b973717194a3e7999f75e4` before the new Local Reviewer contract fix was discovered.

Measured live state before reflecting the new contract fix:

```text
checkout path                     = /home/admin1/projects/debug-ai
checkout mode                     = detached HEAD
checkout HEAD                     = 56e1059f20cf0604a7b973717194a3e7999f75e4
.debugai-input/                   = preserved / untracked
runtime-init                      = Exited (0)
sandbox-init                      = Exited (0)
sandbox-runner                    = Up
debug-ai                          = healthy
runtime root                      = UID/GID 1000:1000 / mode 0700
container entrypoint              = node server/main.js
container workdir                 = /app
loopback /health                  = PASS
pre-server qualification          = PASS at deployed source
source parity                     = PASS at deployed source
Search Gate shadow                = NO_SHADOW_RECORDS / NOT_EVALUABLE
Search skip activation            = NO
```

The live DebugAI runtime is healthy for `56e1059...`, but it is now behind the qualified Local Reviewer contract-fix source. Do not claim exact Current-source parity until `6f2882f...` or its documentation-following descendant is reflected and read back.

## AI Core resource incident and closure

The first real Local Reviewer benchmark after the original source reflection timed out at the 600000 ms role deadline. Direct backend tests showed that this was not a DebugAI timeout-policy defect: AI Core memory ceilings were forcing reclaim/throttling during inference.

Before correction:

```text
four backend mem_limit        = 6656m each
ai-core.slice MemoryHigh      = 24087M
ai-core.slice MemoryMax       = 28904M
Ministral 4-token speed       = about 0.31 tok/s
Ministral container max hits  = observed during tiny inference
parent MemoryHigh hits        = observed during tiny inference
```

Master authorized the AI Core resource correction for the actual operating model: four resident models with normal inference not intended to run as four simultaneous full-memory bursts.

Current AI Core resource authority:

```text
four backend mem_limit        = 9216m each
ai-core.slice MemoryHigh      = 34G
ai-core.slice MemoryMax       = 36G
--cache-ram                   = 4096 unchanged
context                       = 8192 unchanged
backend CPU                   = 3 unchanged
models                        = unchanged
router                        = unchanged
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

The AI Core memory-pressure cause is therefore closed for the tested serial real-role path. The DebugAI Local Reviewer 600000 ms timeout remains unchanged.

## Local Reviewer real measurement defect discovered

After the AI Core resource correction, the next real Local Reviewer run reached the model but returned:

```text
completed   = false
error_code  = ROLE_OUTPUT_JSON_INVALID
AI Core HIGH/MAX/OOM deltas = 0
```

A subsequent RAW capture using the same real benchmark path completed in about 137.6 s and proved the model itself could produce a full valid JSON response:

```text
finish_reason       = stop
completion_tokens   = 835 / 1024
prompt_tokens       = 1547
reasoning_content   = null
Ministral speed     = about 6.07 tok/s
validator parse     = PASS for generic JSON/evidence checks
```

However, the returned shape was noncanonical:

```text
review_state
review_evidence
material_claims
final_review_state
```

while Benchmark summary and Production Workflow consume the canonical Local Reviewer contract:

```text
verdict
decision
claims
```

The generic validator previously allowed the noncanonical shape to pass while semantic checking was shadow-only. Production Workflow then could interpret the missing `verdict` / `decision` as `UNKNOWN`. This was a real production-impacting contract mismatch, not a cosmetic benchmark display issue.

## Local Reviewer canonical contract repair

The source fix anchored at `6f2882fcd05d141f7392ede635dbb31ee15289fb` does all of the following:

- Invocation explicitly requires Local Reviewer fields `verdict`, `decision`, and `claims`.
- The prompt enumerates allowed verdict/decision values and forbids substituting `review_state`, `final_review_state`, or `material_claims` for the required canonical fields.
- Validator requires canonical Local Reviewer `verdict`, `decision`, and `claims` even when semantic mode is shadow.
- Missing or invalid canonical fields fail closed.
- Existing claim/evidence binding remains active.
- Regression tests reject the exact noncanonical shape observed from the real model.
- Existing workflow/E2E/verify/telemetry fixtures were updated to use the canonical contract rather than weakening the validator.

The first CI attempt after tightening the validator exposed seven stale fixtures. Those failures were not suppressed: the fixtures were corrected and the exact qualified anchor subsequently passed all 380 tests and all required CI gates.

## Runtime-image and Server-local input contract

Current runtime-image contract includes `server/`, `orchestrator/`, `bin/`, `mcp/`, `scripts/`, `docs/`, and `package.json`. The Server-local `.debugai-input/` path is excluded from Docker build context and must not be deleted by source reflection.

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
- Local Reviewer canonical output enforcement;
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

## Explicitly not complete

```text
CURRENT_CONTRACT_FIX_SERVER_REFLECTION = NOT_EXECUTED
CURRENT_RUNTIME_EXACT_PARITY           = NOT_VERIFIED_FOR_NEW_HEAD
LOCAL_REVIEWER_CANONICAL_REAL          = NOT_EXECUTED_ON_FIXED_SOURCE
SKILL_EFFECT_ALL_REAL                  = NOT_EXECUTED
MODEL_AB_THINKING_REAL                 = NOT_EXECUTED
MODEL_AB_SAMPLING_REAL                 = NOT_EXECUTED
MODEL_AB_TOKEN_CAP_REAL                = NOT_EXECUTED
REAL_INTEGRATION_E2E                   = NOT_EXECUTED
MCP_LIVE                               = NOT_VERIFIED
VS_CODEX_MCP_REGISTRATION              = NOT_VERIFIED
SEARCH_GATE_SHADOW_REAL                = NOT_EVALUABLE_NO_RECORDS
FALSE_SKIP_ZERO_PROVEN                 = NO
SEARCH_SKIP_ACTIVATION                 = NO
FRESH_CURRENT_RUNTIME_SELF_DEBUG       = NOT_EXECUTED
FINAL_PRODUCTION_EQUIVALENT_E2E        = NOT_EXECUTED
MAIN_MERGE                             = NO
PRODUCTION_PROFILE_CHANGE              = NONE
```

The successful RAW capture on the old source does not qualify the canonical Local Reviewer gate because its output shape was incompatible with Production Workflow.

## Master authorization boundary

Master authorized Current DebugAI Server source reflection/build/recreate after README/document synchronization. That authorization does not include PR/main merge, destructive reset, `.debugai-input/` deletion, runtime-volume deletion, Secret/provider changes, new model downloads, Search Gate skip activation, production profile promotion, or unrelated project mutation.

Master separately authorized the AI Core resource change recorded above. That does not authorize unrelated AI Core model/provider changes.

## Required next-work order

```text
1. finish README/current-state/qualification documentation synchronization for the qualified contract-fix anchor
2. require exact documentation-following HEAD CI PASS
3. preserve .debugai-input and reflect the exact confirmed GitHub revision to /home/admin1/projects/debug-ai
4. rebuild/recreate only required DebugAI Compose services without deleting persistent volumes
5. prove runtime-init/sandbox-init state, DebugAI health, port 8787, source parity, and required image assets
6. rerun pre-server/live-runtime gates where executable and preserve NOT_EXECUTED where not
7. rerun Local Reviewer real measurement and require canonical verdict/decision/claims
8. repeat enough real Local Reviewer measurement to distinguish intermittent JSON-format failure from a closed defect
9. run six-role Skill ON/OFF real suite
10. run one-variable Model A/B: Thinking where eligible -> Sampling -> token cap only when justified
11. run bounded real allowed-repository integration
12. verify MCP exact nine tools + durable continuation
13. accumulate/evaluate Search Gate real shadow without activation
14. run fresh current-runtime self-debug
15. run final production-equivalent closed-loop E2E
16. update current-state docs and Notion from measured results
```

Every unexecuted or not-yet-reflected item stays unexecuted until real evidence exists.
