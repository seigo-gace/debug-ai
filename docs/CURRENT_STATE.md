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

Repository: `seigo-gace/debug-ai`; existing branch: `feat/pre-server-benchmark-gates-20261001`; PR #34 remains OPEN / DRAFT / UNMERGED.

Current source behavior revision is `c9aa6f28ee5c0e4560f6c06ffa667462653c8125`. Exact source-behavior CI on that revision passed Public Readiness Audit #471, Verify #506, Runtime Volume Gate #102, and Core Verify #507. The approved deployed revision remains `b30649a19cd97929a595c639f51fae44c74d4185`; no result from that older live revision is promoted into a Runtime PASS for the current source.

README, this Current State document, and `PRE_SERVER_QUALIFICATION.md` are synchronized to the prompt-cache/context-speed source contract. The final documentation head created by this status closure requires its own exact-head CI before it can be considered the Server reflection candidate. PR #34 is synchronized again after this final documentation commit without changing the repository head.

## Current context / token / cache source contract

The current source supersedes the historical fixed role output ceilings `600/600/600/800/2048/1024` as active runtime policy. Those values remain historical measurement evidence only.

Current source contract:

- model context capacity and model generation ceiling are separate facts;
- role request ceilings come from model-profile authority rather than historical prompt-latency failures;
- Qwen2.5-Coder uses its declared 8192 generation ceiling;
- Qwen3 uses its 32768 native-context ceiling where no smaller model generation ceiling is declared;
- Granite uses its 131072 native-context ceiling where no smaller model generation ceiling is declared;
- Ministral uses its 262144 native-context ceiling where no smaller model generation ceiling is declared;
- every real request is additionally clamped to the independently qualified AI Core runtime context;
- the compatibility `1000` token value is a runtime input reserve used by that runtime-context clamp, not a claim that every model has `native context - 1000` as its model generation maximum;
- `max_tokens` remains a maximum request allowance, not a requirement to consume all tokens;
- `finish_reason=length` is rejected as `AI_CORE_OUTPUT_TRUNCATED` rather than accepted as a successful visible partial response.

Context pressure is connected to the real Tool Loop. Below 85% measured prompt pressure, the prompt can use the existing bounded Active Evidence Window. At or above 85%, the next working context keeps only the five most recent detailed tool results. Older raw tool results remain in durable runtime state; compact historical evidence pointers are retained and may be rehydrated only through admitted `evidence.read`.

Prompt caching is explicit source behavior rather than provider-default behavior:

- AI Core requests `cache_prompt=true` explicitly;
- current llama.cpp-style `timings.cache_n` and `timings.prompt_n` are read as observed cache-hit and processed-prompt token counts, while existing compatible telemetry forms remain supported;
- prompt-evaluation and decode timing remain separately observable;
- Tool Loop keeps its System/Skill/role prefix stable across rounds;
- dynamic final-round control is not written into the canonical Tool Loop user payload; the AI Core transport appends a bounded wire-only final-round control only on the final tool-budget round;
- role telemetry exposes measured `cache_hit_ratio`, cache telemetry completeness, observed prefix hashes, and `prefix_stable` without inventing missing values.

Cache reuse is acceleration only. It does not become evidence, does not bypass current-source/repository binding, does not relax output-schema validation, does not turn a truncated response into success, and does not replace deterministic verification, Local Reviewer, External Final Review, or Strict Completion. A cache hit cannot promote an unverified result.

The current regression suite proves source behavior for 85% pressure compaction, explicit prompt-cache request, current cache telemetry parsing, measured cache-hit ratio, stable Tool Loop prefix, wire-only final-round control, and preservation of the existing canonical user/evidence payload contract. Exact source-behavior CI on `c9aa6f28...` is green.

The last measured live AI Core runtime context remains `8192`. The source can preserve larger model-native/output capability, but prompt caching does not enlarge runtime `n_ctx`. Raising the live runtime context above the measured 8192 boundary is a separate Server/resource change and must be based on fresh RAM, cache, prompt-eval, decode, and end-to-end latency evidence before Master approval. Do not trade reliability or speed for a larger nominal context number.

Researcher A→E durable Work Unit reuse is implemented. A general Block Core execution path for every workflow is not connected and remains a separate unfinished capability; it is not counted as completed by the context/token/cache correction.

## Resumable Skill-effect source contract

The previous `benchmark:skill-effect-all` path executed every real model call serially and only emitted a generic external heartbeat while the suite itself had no durable per-call progress/checkpoint state. Six roles currently require 44 real AI calls in total. That made a long run operationally opaque and made interruption discard completed work.

The resumable implementation anchor `9dc8def709ab277bbfb1e6b6701821791bf4dcd8` routed the six-role measurement through `server/control/resumable-skill-effect-suite.js`. The current source extends that line without replacing its durability contract.

The source contract:

- preserves the existing six role benchmark cases and scoring;
- preserves Skill OFF wins and ties as valid measurement results;
- reports progress by `role -> case -> OFF/ON` rather than generic liveness only;
- checkpoints each completed OFF/ON unit immediately;
- writes checkpoint state atomically;
- resumes completed units instead of paying for the same real inference twice;
- binds checkpoint reuse to a source fingerprint and fails closed when incompatible source is detected;
- does not grant production promotion authority.

The resumable runner is deployed and qualified at approved b30649a. The current context/token/cache correction is source-side only and is not yet reflected.

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
current context/token/cache source live = NOT_DEPLOYED
production profile change       = NONE
Search skip activation           = NO
```

Only `debug-ai` was rebuilt/recreated during the last approved reflection. Both init containers and sandbox-runner were retained. A separate checkpoint written with the runner save routine before recreation loaded after recreation with the identical SHA-256; only that owned probe was removed. Environment hashes, mounts, and production/profile/Search source remained unchanged. Stopped old host Docker clients were retained because no contention requiring cleanup was established.

No Runtime PASS for b30649a is promoted into a Runtime PASS for the current source.

## AI Core resource incident and closure

The first real Local Reviewer benchmark during this qualification phase timed out at the 600000 ms role deadline. Direct backend and cgroup measurements showed that the previous AI Core memory ceilings were forcing reclaim/throttling during inference even though host memory remained available.

Master authorized the shared AI Core resource correction. Last measured authority is:

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

The new cache source contract does not claim a new live cache hit rate, new live latency, or a larger live context. Those require reflection of one approved exact SHA and fresh real runtime measurement.

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
- telemetry-driven 85% context-pressure compaction in the real Tool Loop;
- durable historical evidence pointers with admitted `evidence.read` rehydration;
- explicit prompt-cache requests with current cache-hit/miss telemetry parsing;
- stable Tool Loop System prefix and wire-only final-round control;
- measured cache-hit ratio/prefix-stability telemetry without fabricated values;
- model-profile output ceilings plus qualified runtime-context clamp;
- fail-closed `AI_CORE_OUTPUT_TRUNCATED` handling;
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
- resumable/checkpointed six-role Skill measurement orchestration;
- one-variable Model A/B harness for `thinking`, `temperature`, `top_p`, `top_k`, `max_tokens`;
- exact source/runtime live-readback gate;
- runtime-image qualification/MCP asset packaging;
- production named-volume initialization contract.

Not completed by this source boundary:

- a general Block Core execution path wired across every workflow;
- current-source live Server reflection and runtime verification;
- fresh real cache-hit/prompt-eval/decode/latency measurement on the approved Server runtime;
- any approved increase of live AI Core context above the last measured 8192 setting;
- fresh current-source six-role real measurement;
- fresh current-source Model A/B real measurement;
- current-source real integration/MCP continuation/self-debug/production-equivalent E2E.

## Historical measurement and correction evidence

The first real resumable suite on approved Server revision `b30649a19cd97929a595c639f51fae44c74d4185` returned RC=1 / completed=false / INCOMPLETE: five roles measured and Diagnoser failed at `competing_falsifiable_hypotheses / OFF / AI_CORE_EMPTY`.

| Role | Skill OFF | Skill ON | Result |
| --- | ---: | ---: | --- |
| code_scout | 8/15 | 15/15 | SKILL_ON |
| causal_scout | 3/15 | 3/15 | TIE |
| researcher | 19/25 | 17/25 | SKILL_OFF |
| diagnoser | not completed | not completed | INCOMPLETE / AI_CORE_EMPTY |
| patch_engineer | 9/20 | 9/20 | TIE |
| local_reviewer | 15/15 | 15/15 | TIE |

Metadata-only reproduction established token exhaustion with thinking=true: at 600 tokens, finish_reason=length and content_chars=0; at 800 tokens, finish_reason=length and content_chars=410 with incomplete JSON. A benchmark-only 1024-token candidate returned finish_reason=stop, completion_tokens=911, and complete JSON. Its OFF score was 0/5. The patched intermediate source also completed the previously unexecuted ON unit with finish_reason=stop, 970 completion tokens, and score 1/5. These remain repair diagnostics for one case, not a role winner, full-suite measurement, or current production policy.

Further candidate measurement on source `1e7d907ca706068a7d8cb20e790750e961548050` failed at `cross_refutation / OFF`: HTTP 200, finish_reason=length, 1024 completion tokens, and only 2 visible characters. A one-variable benchmark-only 1536-token candidate completed that unit at 1292 completion tokens with finish_reason=stop and complete JSON, scoring 1/5. The 1536 candidate later completed 7/8 modes and failed at correlation_insufficient/ON: finish_reason=length, completion_tokens=1536, content_chars=382, reasoning_chars=7166. Its role measurement remains INCOMPLETE, with no total/winner. The isolated failed-ON retry at 2048 completed; seven DONE 1536 modes are preserved and are not remeasured or merged across budgets.

The intermediate fixed-2048 source kept `AI_CORE_OUTPUT_TRUNCATED` fail-closed and proved that the historical low allowance could truncate valid work. Source `c9aa6f28...` preserves the model-profile policy established on `023ae8f7...` and adds cache/context-speed operation without reintroducing low output caps. The historical 1024/1536/2048 data remains evidence explaining the correction; it is not the current runtime limit.

| Diagnoser case | 1536 OFF | 1536 ON |
| --- | ---: | ---: |
| competing_falsifiable_hypotheses | 1/5 | 0/5 |
| cross_refutation | 1/5 | 0/5 |
| rejected_hypothesis_avoidance | 0/5 | 3/5 |
| correlation_insufficient | 1/5 | INCOMPLETE / AI_CORE_OUTPUT_TRUNCATED |

The isolated correlation_insufficient/ON retry at 2048 completed with finish_reason=stop, 1205 completion tokens, complete JSON and score 1/5. This lower observed token count does not establish a deterministic minimum allowance or guarantee all future calls. No aggregate/winner combines the 1536 and 2048 records.

The one-mode checkpoint `/app/runtime/benchmarks/diagnoser-candidate-856296e-cap2048.json` is diagnostic-only. The 1536 record remains completed=false with seven DONE and one FAILED mode. No diagnostic process remains active after completion. Historical suite checkpoints remain immutable historical evidence and must not be rebound to the current source fingerprint.

Model A/B Source contract reproduction showed that the old real client accepted a visible JSON response marked finish_reason=length. The actual caller and injected-call measurement boundary now reject it as AI_CORE_OUTPUT_TRUNCATED and use the canonical choice-level finish reason. Real Thinking/Sampling/Token-cap A/B on the current source remains NOT_EXECUTED.

Live MCP stdio on approved b30649a passed initialize, the exact ordered nine-tool list, and real health delegation. No approval/apply shortcut was exposed. Full analyze/start/resume/wait/status/inspect continuation remains NOT_VERIFIED for the current source.

## Current qualification state

```text
CURRENT_SOURCE_BEHAVIOR_HEAD                = c9aa6f28ee5c0e4560f6c06ffa667462653c8125
CURRENT_SOURCE_BEHAVIOR_CI                  = PASS_4_OF_4
CURRENT_SOURCE_PUBLIC_READINESS             = SUCCESS_471
CURRENT_SOURCE_VERIFY                       = SUCCESS_506
CURRENT_SOURCE_RUNTIME_VOLUME_GATE          = SUCCESS_102
CURRENT_SOURCE_CORE_VERIFY                  = SUCCESS_507
CURRENT_SOURCE_DOCUMENT_SYNC                = PASS
CURRENT_SOURCE_PR_SYNC                      = PASS
CURRENT_SOURCE_REFLECTION                   = NOT_EXECUTED
APPROVED_LIVE_SERVER_HEAD                   = b30649a19cd97929a595c639f51fae44c74d4185
APPROVED_LIVE_SOURCE_CI                     = PASS
APPROVED_LIVE_HEALTH                        = PASS
APPROVED_LIVE_EXACT_SHIPPED_PARITY          = PASS_219_FILES
CHECKPOINT_RECREATE_DURABILITY              = PASS_FOR_TESTED_PATH
CONTEXT_PRESSURE_85_SOURCE                  = PASS_ON_C9AA6F28
CONTEXT_PRESSURE_85_LIVE                    = NOT_EXECUTED
PROMPT_CACHE_EXPLICIT_SOURCE                = PASS_ON_C9AA6F28
PROMPT_CACHE_TELEMETRY_SOURCE               = PASS_ON_C9AA6F28
PROMPT_CACHE_LIVE_MEASUREMENT               = NOT_EXECUTED
TOOL_LOOP_PREFIX_STABILITY_SOURCE           = PASS_ON_C9AA6F28
MODEL_PROFILE_OUTPUT_CEILING_SOURCE         = PASS_ON_C9AA6F28
RUNTIME_CONTEXT_CLAMP_SOURCE                = PASS_ON_C9AA6F28
TRUNCATION_FAIL_CLOSED_SOURCE               = PASS_ON_C9AA6F28
LIVE_RUNTIME_CONTEXT_ABOVE_8192             = NOT_AUTHORIZED_NOT_EXECUTED
RESEARCHER_WORK_UNIT_REUSE                  = IMPLEMENTED
GENERAL_BLOCK_CORE_ALL_WORKFLOWS            = NOT_CONNECTED
LOCAL_REVIEWER_CANONICAL_REAL               = PASS_3_OF_3_ON_4C7E727_EXISTING_EVIDENCE
SKILL_EFFECT_ALL_REAL_ON_B30649A            = INCOMPLETE_5_OF_6_AI_CORE_EMPTY
AI_CORE_HIGH_MAX_OOM_OOM_KILL_SUITE_DELTA  = 0_0_0_0
CURRENT_SOURCE_SIX_ROLE_MEASUREMENT         = NOT_EXECUTED
MODEL_AB_THINKING_REAL                      = NOT_EXECUTED
MODEL_AB_SAMPLING_REAL                      = NOT_EXECUTED
MODEL_AB_TOKEN_CAP_REAL                     = NOT_EXECUTED
REAL_INTEGRATION_E2E                        = NOT_EXECUTED
MCP_EXACT_NINE_AND_LIVE_HEALTH             = PASS_ON_APPROVED_B30649A
MCP_CONTINUATION_WORKFLOW                   = NOT_VERIFIED
SEARCH_GATE_SHADOW_REAL                     = NOT_VERIFIED_AT_THIS_BOUNDARY
FALSE_SKIP_ZERO_PROVEN                      = NO
SEARCH_SKIP_ACTIVATION                     = NO
FRESH_CURRENT_RUNTIME_SELF_DEBUG            = NOT_EXECUTED
FINAL_PRODUCTION_EQUIVALENT_E2E             = NOT_EXECUTED
MAIN_MERGE                                  = NOT_EXECUTED
PRODUCTION_PROFILE_CHANGE                   = NONE
```

## Mutation and approval boundary

The completed b30649a reflection does not authorize reflection of a different SHA. Source-side corrections, documentation, existing Draft PR synchronization, and exact-head CI may proceed on the existing feature branch. Keep the existing Server checkout at its explicitly approved revision until Master approves one exact new SHA. Preserve historical checkpoints; do not rebind incompatible data. No profile promotion, live context increase, Search Gate activation, Secret/provider/model change, persistent-state deletion, or unrelated project mutation is permitted by this source result.

## Required next-work order

```text
1. require exact final documentation-head GitHub CI PASS
2. obtain explicit Master approval for one exact reflection SHA; keep Server at approved b30649a until then
3. reflect only that approved SHA, preserving .debugai-input, unmanaged state, both volumes, and historical checkpoints
4. rebuild/recreate only debug-ai and repeat init/health/cleanliness/parity/durability verification
5. measure real cache hit/miss, prompt-eval, decode, total role latency, prefix stability, RAM events, and current 8192 runtime-context behavior
6. keep cache as acceleration-only; any correctness or verification regression fails the candidate regardless of speed gain
7. consider a larger live AI Core context only from measured RAM/speed/quality evidence and separate Master approval; never enlarge n_ctx from model spec alone
8. use a separate source-bound checkpoint on the existing runtime volume; never rebind incompatible old data
9. complete current-source six-role Skill ON/OFF measurement and retain OFF wins/ties
10. Thinking A/B only for explicit boolean roles
11. Sampling A/B one axis at a time using model-bound source candidates
12. token-cap optimization only if preceding measurements justify a smaller candidate
13. real allowed-repository integration, exact-nine MCP continuation, and fresh self-debug
14. Search Gate shadow remains read-only, with zero observations not proving zero false skips
15. final production-equivalent closed loop and Strict Completion
```

Unexecuted, failed, incomplete, and source/runtime-unmatched items retain their actual state.