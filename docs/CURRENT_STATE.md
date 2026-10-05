# DebugAI Current Verified State

This document is the current-state companion to `README.md` and the design authority. It records the latest verified implementation/runtime boundary without rewriting historical design decisions.

## Current synchronization — 2026-10-05

```text
PROJECT                      = DebugAI
REPOSITORY                   = seigo-gace/debug-ai
BRANCH                       = feat/tgserver-async-log-sink-20261003
PR                           = #40 OPEN / DRAFT / UNMERGED
IMPLEMENTATION_QUALIFIED_SHA = b9203e587781daa9c1869dffa6317764642e2742
APPROVED_LIVE_SERVER_SHA     = 83424901502491c6b1dcc8fd223990f91a750d7d
CURRENT_SOURCE_DEPLOYED      = NO
FULL_SUITE_SANDBOX_REAL      = PASS_SOURCE_CI_ISOLATED_RUNTIME
```

Implementation source `b9203e...` passed direct exact-head Development Probe run `37299751542` and canonical tests `454/454`, `FAIL=0`, `SKIP=0`. Artifact `11341055855` binds that run to exact SHA `b9203e...`, with `source_ready=true` and `server_mutation_authorized=false`.

The same implementation change completed SUCCESS in Verify `37299751510`, Public Readiness `37299751493`, Runtime Volume Gate `37299751497`, Targeted TGserver Logging `37299751459`, Development Probe `37299751542`, and Core Verify `37299751516`.

Core Verify executed the existing isolated Sandbox Full-suite and produced:

```text
SANDBOX_SOURCE_REPO_HASH=UNCHANGED
SANDBOX_DOCKER_SOCKET=ABSENT
SANDBOX_REAL_ISOLATION=PASS
SANDBOX_STRICT_SOCKET_DENY=PASS
SANDBOX_DAP_LOOPBACK_ONLY=PASS
SANDBOX_FULL_SUITE_PASS
BACKEND=sidecar+landlock+seccomp
SIGNAL=EXACT_SOURCE_BOUND_CHILD_ONLY
TESTS=454
PASS=454
FAIL=0
SKIPPED=0
```

This closes the previous source/CI Sandbox compatibility blocker without test deletion, skip acceptance, arbitrary environment inheritance, syscall-policy relaxation, or a second Sandbox/service/runtime. `DEBUG_AI_REQUIRE_TS7_REAL=1` is fixed only for provenance-qualified exact-source DebugAI `package.test` and is absent from ordinary Sandbox jobs.

Documentation synchronization follows the implementation qualification anchor. These documentation-only commits do not change the live Server state and require their own exact-head CI before the resulting documentation SHA can become a reflection candidate.

The live Server remains at approved revision `83424901502491c6b1dcc8fd223990f91a750d7d`. No PR #40 source/documentation SHA has been reflected live in this phase. Merge, Deploy/recreate/restart, Secret/provider/model/profile changes, Search Gate activation and persistent-state mutation remain separate approval boundaries.

Latest source/CI evidence is summarized in [`CURRENT_SOURCE_QUALIFICATION.md`](CURRENT_SOURCE_QUALIFICATION.md). Repository responsibility mapping is in [`PROJECT_TREE.md`](PROJECT_TREE.md). Where the historical record below contains earlier PR numbers, candidate SHAs, source test counts, or an unresolved Sandbox state, retain it as dated evidence; it does not override this synchronization section.

## Authority separation

```text
Design / architecture              = docs/DURABLE-CONTINUATION-DESIGN.md
Current implementation/runtime     = this document
Latest source/CI qualification     = docs/CURRENT_SOURCE_QUALIFICATION.md
Project responsibility tree        = docs/PROJECT_TREE.md
CLI / parent-agent usage           = DEBUGAI.md
MCP transport contract             = docs/MCP_ADAPTER.md
Qualification contract             = docs/PRE_SERVER_QUALIFICATION.md
Live MCP handoff                   = docs/CODEX_MCP_LIVE_HANDOFF.md
Server/VPS/Docker operations       = current G-ACE-inc/server-core authority
```

GitHub source, exact-head CI, shared AI Core runtime, live DebugAI Server state, and production state are separate facts. No older report promotes an unverified current state.

## Historical repository/live record retained below

The following material preserves earlier measured states and reasons for later repairs. Statements that use the word “current” inside this retained history are current only for their recorded historical boundary and are superseded where the synchronization section above says otherwise.

The approved live revision is `83424901502491c6b1dcc8fd223990f91a750d7d`. Its exact-head GitHub CI passed Public Readiness #484, Verify #519, Runtime Volume Gate #115, and Core Verify #520. PR #34 was the earlier Draft PR boundary recorded when the following live evidence was produced.

The approved live source propagates the MCP request as task data, specifies canonical Causal Scout final output, and forwards Local Reviewer benchmark telemetry. Fresh runtime evidence at that boundary confirms the request-backed search query and accepted canonical Causal Scout claims with UNKNOWN; broader semantic quality and Strict Completion remain unqualified. Later source-side repairs require separate exact-SHA reflection authorization.

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

The regression suite proves source behavior for 85% pressure compaction, explicit prompt-cache request, current cache telemetry parsing, measured cache-hit ratio, stable Tool Loop prefix, wire-only final-round control, and preservation of the existing canonical user/evidence payload contract. Historical exact source-behavior CI on `c9aa6f28...` was green.

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

The resumable runner, context/token/cache correction and MCP task/Causal Scout/output-telemetry correction are deployed at approved revision 83424901502491c6b1dcc8fd223990f91a750d7d. Later Sandbox/telemetry/history and TGserver log-sink source work remains source-side until separately reflected.

## Current live DebugAI Server boundary

Fresh readback after the approved reflection:

```text
checkout path                    = /home/admin1/projects/debug-ai
checkout mode                    = detached HEAD
approved checkout HEAD           = 83424901502491c6b1dcc8fd223990f91a750d7d
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
existing environment            = all environment hashes unchanged from pre-reflection
production profile change       = NONE
Search skip activation           = NO
```

The checkpoint probe remains retained as evidence. No old checkpoint was rebound to a new source fingerprint. Related historical current-source regression tests passed 62/62 in the existing container using a complete temporary source archive; Compose contract tests require compose.yaml, which is not shipped in /app. Production environment variables were isolated only in test child processes.

### Historical live MCP investigation

Fresh stdio initialize, exact nine-tool discovery, health, start, status, bounded wait and inspect were executed on the approved live revision. No approve/apply shortcut exists.

Retained run `run_murmrr7b_62f93013f4` cannot continue across the reflection: startup recovery preserved its input but failed closed with REPOSITORY_REVISION_MISMATCH against its saved source-tree binding. It is BLOCKED, not resumable. No snapshot binding or historical checkpoint was overwritten to force reuse. Startup logged 24 incompatible runs; this is a recovery consequence, not successful continuation.

Serial run `run_murr1d8u_a6fb01c3d9` investigated sandbox chmod EPERM. Its saved research-context digest was valid; the search query exactly matched its retained request. The Causal Scout stage passed the unchanged validator with canonical claims/type/statement and UNKNOWN. This closed the previously measured final-output shape failure for that execution. It did not prove a completed diagnosis or semantic quality: Codex rejected logically reversed falsification conditions and any suggestion requiring seccomp relaxation. Researcher A→E completed with a durable FINAL result: INSUFFICIENT_EVIDENCE, answer UNKNOWN, no claimed source evidence. Diagnoser later reached AI_CORE_TIMEOUT; job status was RETRY_WAIT at the DIAGNOSER cursor with the same completed researcher execution/checkpoint retained. No completed analysis or final diagnosis was claimed.

The saved runtime telemetry exposed a persistence defect in the then-live boundary: numeric token counts and completeness flags were redacted by the broad secret-field rule. Later source permits only typed nonnegative integer/null counters and boolean completeness fields in the exact canonical v2 telemetry schema. Credentials, private reasoning, strings/objects/arrays, invalid numeric values, other schemas and untagged token fields remain redacted. Missing historical counts are not reconstructed. A second request-only defect was reproduced directly in the deployed hook: UNKNOWN analysis with failure=null threw REJECTED_HISTORY_FAILURE_RECORD_REQUIRED even without rejected hypotheses. Later source requires a failure identity only when persisting actual structured REJECTED history; request-only analysis can retain UNKNOWN without fabricating a failure, while unbound rejection still fails closed. Real model completion on later source remains pending reflection.

The Sandbox compatibility defect that was unresolved at this historical boundary is now closed at the newer source/CI isolated-runtime boundary described at the top of this document and in `SANDBOX_SUITE_COMPATIBILITY.md`. That closure is not a claim of live reflection.

### Historical read-only verification and performance boundary

MCP verify completed end-to-end on 83424901502491c6b1dcc8fd223990f91a750d7d: verification_id verify_7a9881cb-0f96-493f-925f-aa5fae9b9bbc, verdict FAIL, Local Reviewer BLOCKED/BLOCKED, local_review_error=null. Sandbox job JOB_1c7d810498e2daa468a3a9a9 returned code 1 in 28730 ms. Read-only source immutability passed for all three selected paths; patch_applied=false. This is successful transport of a failed verification, not qualification PASS.

The partial run/verify measurement window recorded parent cgroup High/Max/OOM/OOM-kill deltas 0/1705/0/0. Performance qualification therefore failed the zero-Max-delta requirement. Qwen3 was observed at 9660715008 bytes against its unchanged 9663676416-byte ceiling; resource pressure contributing to the diagnosis timeout is an INFERENCE, not a proven exclusive cause. RAM samples are observations, not a full-run peak. Context, all four backend resources/models and production configuration remain unchanged. No paid fallback, new model or larger context was used.

Saved Scout telemetry reported Code Scout prompt-eval/decode/role-wall 84406.971/33858.678/118420 ms, cache hit ratio 0.4092465753424658 over one call; Causal Scout totals 373163.799/297818.43700000003/671370 ms, ratio 0.3601138057173825 over two calls with a stable observed prefix. Prompt/completion/cache-hit/cache-miss counts were redacted in durable persistence and remain UNKNOWN; they are not reconstructed. These measurements do not establish semantic-quality or speed qualification.

### Historical fa690041 Local Reviewer cache measurement

Actual local-model inference used the fixed benchmark fixture through the deployed production adapter, with existing telemetry captured without storing hidden reasoning. This was a real-model contract/cache measurement with fixture input, not a successful full repository verification or Strict Completion.

Two calls completed with canonical output, strict evidence binding, verdict PASS, and decision HANDOFF. They did not establish decision DONE. Provider-observed prompt tokens were 2466 in both calls; completion tokens were 480 and 481. Cache hit/miss were 257/2209 and 2465/1; prompt-evaluation times were 161306.757 ms and 528.389 ms; decode times were 115949.636 ms and 102498.591 ms; total role elapsed times were 277563 ms and 103067 ms. The observed prefix hash was identical. The third call also returned canonical PASS/HANDOFF (7 claims, 2466 prompt tokens, 481 completion tokens, hit/miss 2465/1, prompt-eval 185.765 ms, decode 88746.433 ms, elapsed 402251 ms). Its request overlapped the Local Reviewer invoked by verification; the additional upstream time is consistent with server queueing (INFERENCE, not separately measured). It is excluded from uncontended serial speed evaluation. No additional call was made merely to hide that contention.

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

Historical cache and timing measurements on fa690041 are reported above. The runtime context remains 8192; broader semantic-quality improvement is not proven by those measurements.

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
- production named-volume initialization contract;
- existing Sandbox sidecar Full-suite execution qualified for the current implementation anchor with 454/454 PASS and zero skip.

Not completed by this source boundary:

- a general Block Core execution path wired across every workflow;
- current feature-branch source live Server reflection and runtime verification;
- fresh real cache-hit/prompt-eval/decode/latency measurement on the current feature-branch source;
- any approved increase of live AI Core context above the last measured 8192 setting;
- fresh current-source six-role real measurement;
- fresh current-source Model A/B real measurement;
- current-source real integration/MCP continuation/self-debug/production-equivalent E2E;
- Strict Completion on the current source.

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
IMPLEMENTATION_QUALIFIED_SHA = b9203e587781daa9c1869dffa6317764642e2742
IMPLEMENTATION_CANONICAL_TESTS = PASS_454_OF_454_ZERO_SKIP
FULL_PACKAGE_TEST_IN_SANDBOX = PASS_454_OF_454_ZERO_SKIP
SANDBOX_BACKEND = sidecar+landlock+seccomp
SANDBOX_SIGNAL_SCOPE = EXACT_SOURCE_BOUND_CHILD_ONLY
APPROVED_LIVE_SERVER_HEAD = 83424901502491c6b1dcc8fd223990f91a750d7d
CURRENT_SOURCE_REFLECTION = NOT_EXECUTED_NOT_AUTHORIZED
LIVE_CURRENT_SOURCE_STATE = NOT_REFLECTED
CURRENT_SOURCE_SIX_ROLE_MEASUREMENT = NOT_EXECUTED
MODEL_AB_THINKING_SAMPLING_TOKEN_CAP = NOT_EXECUTED
REAL_CURRENT_SOURCE_INTEGRATION_E2E = NOT_EXECUTED
GENERAL_BLOCK_CORE_ALL_WORKFLOWS = NOT_CONNECTED
SEARCH_SKIP_ACTIVATION = NO
STRICT_COMPLETION = NOT_VERIFIED
MAIN_MERGE = NOT_EXECUTED
PRODUCTION_PROFILE_CHANGE = NONE
```

## Mutation and approval boundary

The approved live reflection of `834249...` does not authorize reflection of a different SHA. Source-side corrections, documentation, existing Draft PR synchronization, and exact-head CI may proceed on the existing feature branch. Keep the existing Server checkout at its explicitly approved revision until Master approves one exact new SHA. Preserve historical checkpoints; do not rebind incompatible data. No profile promotion, live context increase, Search Gate activation, Secret/provider/model change, persistent-state deletion, or unrelated project mutation is permitted by the source result.

## Required next-work order

```text
1. finish README / Current / Sandbox / Project Tree / PR / Notion synchronization and require exact final-documentation-head GitHub CI PASS
2. obtain separate Master approval for that exact post-documentation SHA; preserve approved live 83424901502491c6b1dcc8fd223990f91a750d7d until then
3. after approval, re-read current server-core deployment authority and reflect only the approved SHA while preserving volumes, checkpoints, unmanaged state and auxiliary containers
4. reverify exact host/container/source parity and health
5. run a fresh real DebugAI operation and retrieve fresh P004 evidence through the already-working shared TGserver Reader
6. continue real current-runtime integration, MCP durable continuation, semantic-quality/benchmark qualification, self-debug and Strict Completion from measured evidence
```

Unexecuted, failed, incomplete, source/runtime-unmatched, and approval-blocked items retain their actual state.
