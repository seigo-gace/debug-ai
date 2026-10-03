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

The approved live revision is `fa690041349c6dd7bfb8dae3121b2e1f724dff87`. Its exact-head GitHub CI passed Public Readiness #483, Verify #518, Runtime Volume Gate #114, and Core Verify #519. PR #34 remains OPEN / DRAFT / UNMERGED.

The current feature-branch candidate preserves the MCP raw request as task data through all four analysis roles and search, adds an explicit production Causal Scout final-output contract, and exposes the existing Local Reviewer Tool Loop telemetry in the benchmark result. These corrections are source-side only; they are not present in the approved live image. Local verification passed 415 tests, including the real TypeScript 7 gate, with zero failures and zero skips. The final candidate head still requires fresh exact-head CI and separate exact-SHA reflection approval.

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

The resumable runner and context/token/cache correction are deployed at the approved fa690041 revision. The production Causal Scout/output-telemetry candidate remains source-side only.

## Current live DebugAI Server boundary

Fresh readback after the approved reflection:

```text
checkout path                    = /home/admin1/projects/debug-ai
checkout mode                    = detached HEAD
approved checkout HEAD           = fa690041349c6dd7bfb8dae3121b2e1f724dff87
tracked worktree                 = CLEAN
.debugai-input and unmanaged state = content hashes preserved
runtime-init                     = exited / exit=0 / same container and image
sandbox-init                     = exited / exit=0 / same container and image
sandbox-runner                   = running / same container and image
debug-ai                         = running / healthy / only recreated service
Host/Container shipped parity    = PASS / 223 tracked files / zero mismatches
persistent volumes              = both identities and mountpoints preserved
historical checkpoints          = all pre-reflection hashes preserved
checkpoint recreate durability  = runner-written probe loaded with identical hash
qualified runtime context       = 8192 / existing .env owner
AI Core backend context         = 8192 on all four unchanged backends
existing environment            = unchanged except added context qualification key
production profile change       = NONE
Search skip activation           = NO
```

The checkpoint probe remains retained as evidence. No old checkpoint was rebound to a new source fingerprint. Related current-source regression tests passed 62/62 in the existing container using a complete temporary source archive; Compose contract tests require compose.yaml, which is not shipped in /app. Production environment variables were isolated only in test child processes.

### Current live MCP investigation

Real stdio initialize, exact ordered nine-tool discovery, health, start, status, bounded wait, and inspect were executed against the approved live source. No approve/apply shortcut exists. Exact run ID: `run_murmrr7b_62f93013f4`.

The run is RETRY_WAIT with `ROLE_SEMANTIC_INVALID:causal_scout:EXPECTED_SHAPE_MISSING:candidates|hypotheses|causal_chain|claims`. No completed analysis or evidence-backed diagnosis is claimed. Source inspection confirmed that the production caller did not specify a required final role-shape field; the candidate now explicitly requires canonical claims, preserves UNKNOWN, and leaves validation fail-closed. A second source defect was reproduced deterministically: MCP start supplies rawRequest with failure=null, but the production caller omitted rawRequest from all analysis-role inputs and used the generic search query "debug failure". The candidate now forwards the original task as JSON data through scouts, durable/non-durable Researcher and Diagnoser, and uses it as the search fallback without moving it into system instructions. The runtime failures are not yet closed. Resume must retain this run ID and must not be reported successful before real execution.

The full repository package.test inside the unchanged sandbox failed: test fixtures call chmod, which sandbox-exec intentionally denies with EPERM. This is separate from the passing repository verification outside that sandbox. The sandbox policy, tests, and existing runner were not weakened or recreated. Read-only MCP verify was invoked; its client timed out, so MCP transport completion is not claimed. Server evidence later proved verification_id `verify_211e3f83-43e0-4452-a1a6-0156813ddc2a`, verdict FAIL, Local Reviewer FAIL/BLOCKED, and source-immutability invariants PASS for both selected paths. No patch was applied.

### Current Local Reviewer cache measurement

Actual local-model inference uses the fixed benchmark fixture through the deployed production adapter, with existing telemetry captured without storing hidden reasoning. This is a real-model contract/cache measurement with fixture input, not a successful full repository verification or Strict Completion.

Two calls completed with canonical output, strict evidence binding, verdict PASS, and decision HANDOFF. They do not establish decision DONE. Provider-observed prompt tokens were 2466 in both calls; completion tokens were 480 and 481. Cache hit/miss were 257/2209 and 2465/1; prompt-evaluation times were 161306.757 ms and 528.389 ms; decode times were 115949.636 ms and 102498.591 ms; total role elapsed times were 277563 ms and 103067 ms. The observed prefix hash was identical. The third call also returned canonical PASS/HANDOFF (7 claims, 2466 prompt tokens, 481 completion tokens, hit/miss 2465/1, prompt-eval 185.765 ms, decode 88746.433 ms, elapsed 402251 ms). Its request overlapped the Local Reviewer invoked by verification; the additional upstream time is consistent with server queueing (INFERENCE, not separately measured). It is excluded from uncontended serial speed evaluation. No additional call was made merely to hide that contention.

Measurement artifact: `/app/runtime/benchmarks/cache-local-reviewer-fa690041.json`. Parent and all four backend cgroup High/Max/OOM/OOM-kill deltas were zero across the measured window. A later bounded 98-sample parent RAM window observed 33890037760–34465808384 bytes; this is a sampled window, not the complete-run peak. All three prefixes were identical. Canonical acceptance remains separate from semantic-quality qualification and Strict Completion. Cache remains acceleration-only, and broader semantic-quality regression remains unproven.

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

Current observed cache and timing measurements on approved fa690041 are reported above. The runtime context remains 8192; broader semantic-quality improvement is not proven by those measurements.

## Local Reviewer defect history and closure

The Local Reviewer qualification history has distinct causes and must not be collapsed.

1. An early real run timed out while AI Core was under severe memory reclaim pressure.
2. After the authorized AI Core resource correction, one run returned `ROLE_OUTPUT_JSON_INVALID`.
3. A RAW capture returned complete JSON but noncanonical top-level `review_state/material_claims` instead of `verdict/decision/claims`.
4. Source was tightened to require canonical top-level output.
5. Real measurement on the then-live runtime produced three consecutive `CLAIM_TYPE_INVALID` failures because the model output omitted/invalidly represented canonical `claims[].type`.
6. The validator remained strict. The invocation contract was repaired to explicitly require `type = FACT | INFERENCE | HYPOTHESIS | UNKNOWN | REJECTED` and the corresponding evidence/falsification/counter-evidence rules.
7. That fixed source was reflected to Server revision `4c7e7273424d097fc4bfb60a727824c944ef374b` and measured three consecutive times through the real role path.

Historical measured Local Reviewer result on `4c7e727...`:

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
APPROVED_LIVE_SERVER_HEAD = fa690041349c6dd7bfb8dae3121b2e1f724dff87
APPROVED_LIVE_EXACT_SHIPPED_PARITY = PASS_223_FILES
CHECKPOINT_RECREATE_DURABILITY = PASS_FOR_TESTED_PATH
CONTEXT_TOKENS = 8192
CANDIDATE_SOURCE_TESTS = PASS_415_OF_415_ZERO_SKIP
CANDIDATE_EXACT_HEAD_CI = FRESH_READBACK_REQUIRED
CANDIDATE_SOURCE_REFLECTION = NOT_EXECUTED_NOT_AUTHORIZED
LOCAL_REVIEWER_CURRENT_REAL = THREE_CANONICAL_PASS_HANDOFF_THIRD_CONTENDED
PROMPT_CACHE_CURRENT_REAL = OBSERVED_THREE_CALLS_TWO_SERIAL_SAMPLES
MCP_EXACT_NINE_AND_HEALTH = PASS_ON_FA690041
MCP_START_STATUS_WAIT_INSPECT = EXECUTED
MCP_ANALYSIS = RETRY_WAIT_CAUSAL_SHAPE_FAILURE
MCP_VERIFY = CLIENT_TIMEOUT_SERVER_VERDICT_FAIL_REVIEW_BLOCKED
FULL_PACKAGE_TEST_IN_SANDBOX = FAIL_EPERM_CHMOD
CURRENT_SOURCE_SIX_ROLE_MEASUREMENT = NOT_EXECUTED
MODEL_AB_THINKING_SAMPLING_TOKEN_CAP = NOT_EXECUTED
REAL_INTEGRATION_E2E = NOT_EXECUTED
GENERAL_BLOCK_CORE_ALL_WORKFLOWS = NOT_CONNECTED
SEARCH_GATE_SHADOW_REAL = NOT_VERIFIED_AT_THIS_BOUNDARY
SEARCH_SKIP_ACTIVATION = NO
STRICT_COMPLETION = NOT_VERIFIED
MAIN_MERGE = NOT_EXECUTED
PRODUCTION_PROFILE_CHANGE = NONE
```

## Mutation and approval boundary

The completed fa690041 reflection does not authorize reflection of a different SHA. Source-side corrections, documentation, existing Draft PR synchronization, and exact-head CI may proceed on the existing feature branch. Keep the existing Server checkout at its explicitly approved revision until Master approves one exact new SHA. Preserve historical checkpoints; do not rebind incompatible data. No profile promotion, live context increase, Search Gate activation, Secret/provider/model change, persistent-state deletion, or unrelated project mutation is permitted by this source result.

## Required next-work order

```text
1. require exact candidate-head GitHub CI PASS for the MCP task/Causal Scout/output-telemetry corrections
2. obtain separate Master approval for that exact new SHA; preserve the approved live fa690041349c6dd7bfb8dae3121b2e1f724dff87 until then
3. reflect only the approved candidate while preserving both volumes, checkpoints, unmanaged state and existing auxiliary containers
4. reverify exact parity and resume the retained MCP run only when compatible and actually resumable
5. close the measured causal-output defect with real runtime evidence; do not relax the validator or sandbox
6. finish serial Local Reviewer/cache qualification and keep contested samples labeled
7. use a separate compatible source-bound checkpoint for current six-role Skill ON/OFF measurement
8. retain Skill OFF wins/ties; run Thinking A/B only for explicit boolean roles
9. perform Sampling A/B one axis at a time and token-cap optimization only from prior evidence
10. complete real integration, MCP durable continuation, self-debug, read-only Search shadow and Strict Completion
```

Unexecuted, failed, incomplete, and source/runtime-unmatched items retain their actual state.
