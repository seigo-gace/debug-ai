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

Repository: `seigo-gace/debug-ai`; existing branch: `feat/pre-server-benchmark-gates-20261001`; PR #34 remains OPEN / DRAFT / UNMERGED. Resumable implementation anchor is `9dc8def709ab277bbfb1e6b6701821791bf4dcd8`; approved deployed revision is `b30649a19cd97929a595c639f51fae44c74d4185`.

Exact b30649a CI succeeded for public-readiness, verify, core-verify, runtime-volume, dependency-review, and legacy-authority. This correction revision changes the Diagnoser benchmark allowance and truncated-response classification; its exact-head CI must be read back independently. It is not yet approved or reflected to Server.

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

The resumable runner is deployed and qualified at approved b30649a. The Diagnoser correction in this revision remains source-side pending its own CI and approved reflection.

## Current live DebugAI Server boundary

Measured after the explicitly approved reflection:

```text
checkout path                    = /home/admin1/projects/debug-ai
checkout mode                    = detached HEAD
approved checkout HEAD           = b30649a19cd97929a595c639f51fae44c74d4185
tracked worktree                 = CLEAN
.debugai-input/                  = PRESENT / PRESERVE
unmanaged local files            = pre/post content hashes match
runtime-init                     = exited / exit=0 / container unchanged
sandbox-init                     = exited / exit=0 / container unchanged
sandbox-runner                   = running / container unchanged
debug-ai                         = running / healthy / rebuilt and recreated
loopback /health                 = PASS / expected service and safety contract
approved Host/Container parity   = PASS / 219 shipped tracked files / zero mismatches
persistent volumes              = both identities and mountpoints preserved
checkpoint recreate durability  = PASS / separate runner-written checkpoint probe
new runner deployed             = YES at approved b30649a
benchmark command               = node server/control/resumable-skill-effect-suite.js
checkpoint path                 = /app/runtime/benchmarks/skill-effect-suite-checkpoint.json
corrected Diagnoser source live  = NOT_DEPLOYED
production profile change       = NONE
Search skip activation           = NO
```

Only `debug-ai` was rebuilt/recreated. Both init containers and sandbox-runner were retained. A separate checkpoint written with the runner save routine before recreation loaded after recreation with the identical SHA-256; only that owned probe was removed. Environment hashes, mounts, and production/profile/Search source remained unchanged. Stopped old host Docker clients were retained because no contention requiring cleanup was established.

No Runtime PASS for b30649a is promoted into a Runtime PASS for this pending Diagnoser correction.

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

## Current measurement and Diagnoser correction

The first real resumable suite on approved Server revision `b30649a19cd97929a595c639f51fae44c74d4185` returned RC=1 / completed=false / INCOMPLETE: five roles measured and Diagnoser failed at `competing_falsifiable_hypotheses / OFF / AI_CORE_EMPTY`.

| Role | Skill OFF | Skill ON | Result |
| --- | ---: | ---: | --- |
| code_scout | 8/15 | 15/15 | SKILL_ON |
| causal_scout | 3/15 | 3/15 | TIE |
| researcher | 19/25 | 17/25 | SKILL_OFF |
| diagnoser | not completed | not completed | INCOMPLETE / AI_CORE_EMPTY |
| patch_engineer | 9/20 | 9/20 | TIE |
| local_reviewer | 15/15 | 15/15 | TIE |

Metadata-only reproduction established token exhaustion with thinking=true: at 600 tokens, finish_reason=length and content_chars=0; at the unchanged production allowance of 800 tokens, finish_reason=length and content_chars=410 with incomplete JSON. A benchmark-only 1024-token candidate returned finish_reason=stop, completion_tokens=911, and complete JSON. Its OFF score was 0/5. The patched source also completed the previously unexecuted ON unit with finish_reason=stop, 970 completion tokens, and score 1/5. These are repair diagnostics for one case, not a role winner, full-suite measurement, or quality PASS.

This source correction sets the fixed Diagnoser benchmark allowance to 1024 for both OFF and ON and rejects finish_reason=length as AI_CORE_OUTPUT_TRUNCATED, with bounded public failure metadata. Production Diagnoser remains at 800 tokens. Cases, scorers, models, thinking, temperature, Skill semantics, and production profiles are unchanged. Targeted tests passed 6/6; related benchmark/qualification tests passed 40/40. The correction still requires its own exact-head CI and explicitly approved Server reflection.

The existing checkpoint remains preserved at `/app/runtime/benchmarks/skill-effect-suite-checkpoint.json`, bound to fingerprint `810356ebbffd98fee5fff0ba1cfbb03613248857ac7ebb4da034236721b38568`. The corrected source fingerprint is `019bf433c3299d90769569393fceec23718228ac89663bb4d5fd67c1b663b312`. They are incompatible: do not edit/rebind the old checkpoint or replay it against the corrected source. Use a distinct checkpoint filename on the same existing runtime volume when the new revision is approved. The five completed role results remain historical measurement evidence for b30649a; they are not current corrected-source measurements.

## Current qualification state

```text
APPROVED_LIVE_SERVER_HEAD                  = b30649a19cd97929a595c639f51fae44c74d4185
APPROVED_LIVE_SOURCE_CI                    = PASS
APPROVED_LIVE_HEALTH                       = PASS
APPROVED_LIVE_EXACT_SHIPPED_PARITY          = PASS_219_FILES
CHECKPOINT_RECREATE_DURABILITY             = PASS_FOR_TESTED_PATH
CURRENT_CORRECTION_EXACT_HEAD_CI           = REQUIRES_REMOTE_READBACK
CURRENT_CORRECTION_REFLECTION              = NOT_EXECUTED
LOCAL_REVIEWER_CANONICAL_REAL              = PASS_3_OF_3_ON_4C7E727_EXISTING_EVIDENCE
SKILL_EFFECT_ALL_REAL_ON_B30649A           = INCOMPLETE_5_OF_6_AI_CORE_EMPTY
AI_CORE_HIGH_MAX_OOM_OOM_KILL_SUITE_DELTA  = 0_0_0_0
DIAGNOSER_1024_FAILED_OFF_CASE_DIAGNOSTIC   = COMPLETE_JSON_STOP_911_TOKENS_SCORE_0_OF_5
DIAGNOSER_1024_FIRST_ON_CASE_DIAGNOSTIC     = COMPLETE_JSON_STOP_970_TOKENS_SCORE_1_OF_5
CORRECTED_SOURCE_SIX_ROLE_MEASUREMENT      = NOT_EXECUTED
MODEL_AB_THINKING_REAL                     = NOT_EXECUTED
MODEL_AB_SAMPLING_REAL                     = NOT_EXECUTED
MODEL_AB_TOKEN_CAP_REAL                    = NOT_EXECUTED
REAL_INTEGRATION_E2E                       = NOT_EXECUTED
MCP_LIVE                                   = NOT_VERIFIED
SEARCH_GATE_SHADOW_REAL                    = NOT_VERIFIED_AT_THIS_BOUNDARY
FALSE_SKIP_ZERO_PROVEN                     = NO
SEARCH_SKIP_ACTIVATION                     = NO
FRESH_CURRENT_RUNTIME_SELF_DEBUG           = NOT_EXECUTED
FINAL_PRODUCTION_EQUIVALENT_E2E            = NOT_EXECUTED
MAIN_MERGE                                 = NOT_EXECUTED
PRODUCTION_PROFILE_CHANGE                  = NONE
```

## Mutation and approval boundary

The completed b30649a reflection does not authorize reflection of a different SHA. Source-side corrections and documentation may proceed on the existing feature branch. Keep existing Server checkout at its explicitly approved revision until approval for the corrected exact SHA. Preserve the old checkpoint even though it cannot be resumed under the changed fingerprint. No profile promotion, Search Gate activation, Secret/provider/model change, persistent-state deletion, or unrelated project mutation is permitted by a benchmark result.

## Required next-work order

```text
1. require exact corrected-source GitHub CI PASS
2. obtain explicit approval for one exact correction SHA; keep Server at approved b30649a until then
3. reflect only that approved SHA, preserving .debugai-input, unmanaged state, both volumes, and the old checkpoint
4. rebuild/recreate only debug-ai and repeat init/health/cleanliness/parity/durability verification
5. use a separate source-bound checkpoint on the existing runtime volume; never rebind incompatible old data
6. complete corrected-source six-role Skill ON/OFF measurement and retain OFF wins/ties
7. Thinking A/B only for explicit boolean roles
8. Sampling A/B one axis at a time using model-bound source candidates
9. token-cap optimization only if preceding measurements justify a smaller candidate
10. real allowed-repository integration, exact-nine MCP continuation, and fresh self-debug
11. Search Gate shadow remains read-only, with zero observations not proving zero false skips
12. final production-equivalent closed loop and Strict Completion
```

Unexecuted, failed, incomplete, and source/runtime-unmatched items retain their actual state.
