# DebugAI Pre-Server Qualification

## Purpose

Separate source-complete measurement logic from real Server/model/runtime measurements. Source readiness must never be relabeled as a live PASS.

Read [`CURRENT_STATE.md`](CURRENT_STATE.md) for the current source/runtime boundary.

Server/VPS/Docker mutation is governed by current `G-ACE-inc/server-core` authority plus explicit Master authorization.

## Source qualification and live boundary

The approved live revision is `83424901502491c6b1dcc8fd223990f91a750d7d`. Its exact-head GitHub CI passed Public Readiness #484, Verify #519, Runtime Volume Gate #115, and Core Verify #520. PR #34 remains OPEN / DRAFT / UNMERGED.

The approved live source now propagates the MCP request as task data, specifies canonical Causal Scout final output, and forwards Local Reviewer benchmark telemetry. Fresh runtime evidence confirms the request-backed search query and accepted canonical Causal Scout claims with UNKNOWN; broader semantic quality and Strict Completion remain unqualified. The new source-side candidate repairs sandbox test fixtures and request-only history handling, and narrowly preserves typed canonical telemetry counts during secret scrubbing. Its runtime reflection requires separate exact-SHA authorization.

The approved live runtime has exact shipped parity across 223 files and qualified context 8192. Both persistent volumes, historical checkpoints, unmanaged state, init containers and sandbox-runner were preserved. Current Causal Scout real failure, cache measurement limits and read-only verification state are detailed in [`CURRENT_STATE.md`](CURRENT_STATE.md). Source tests do not promote the failed sandbox verification or pending runtime candidate to PASS.

## Current context / token / prompt-cache qualification contract

The current source supersedes the historical fixed role output ceilings `600/600/600/800/2048/1024` as active policy. Historical low-cap measurements remain evidence explaining why the policy changed, but they are not current production ceilings.

Current source contract:

- `max_tokens` is a request ceiling, not mandatory consumption;
- prompt/prefill latency does not justify shrinking generation allowance;
- model context capacity and model generation ceiling are separate facts;
- role request ceilings come from model-profile authority;
- Qwen2.5-Coder has a declared generation ceiling of 8192;
- Qwen3 uses a 32768 native-context ceiling where no smaller generation ceiling is declared;
- Granite uses a 131072 native-context ceiling where no smaller generation ceiling is declared;
- Ministral uses a 262144 native-context ceiling where no smaller generation ceiling is declared;
- every real request is additionally clamped to the independently qualified AI Core runtime context;
- the compatibility `1000` token constant is a runtime input reserve for that clamp, not a universal `native context - 1000` model-generation claim;
- `finish_reason=length` is fail-closed as `AI_CORE_OUTPUT_TRUNCATED`.

Context compression is connected to the real Tool Loop:

- below 85% measured prompt pressure, the bounded Active Evidence Window may retain more detailed recent observations subject to its existing item/character limits;
- at or above 85%, the next working context retains only the five most recent detailed tool results;
- older raw tool results remain in durable runtime state;
- compact historical refs remain pointers, not evidence text;
- older content is rehydrated only through admitted `evidence.read`;
- the current regression suite proves that the next AI call changes to the five-item detailed window when measured prompt pressure reaches the threshold.

Prompt-cache source qualification additionally requires:

- `cache_prompt=true` is explicitly present in the AI Core request rather than relying on a provider default;
- current llama.cpp `timings.cache_n` and `timings.prompt_n` are consumed as observed cache-hit and processed-prompt token counts, with compatible prior telemetry forms retained;
- missing cache metrics stay unknown/null rather than being fabricated;
- cache-hit ratio is derived only when the complete observed hit/miss denominator is available;
- Tool Loop System/Skill/role prefix stays stable across rounds;
- final-round control is kept out of the canonical Tool Loop user/evidence payload and is added only at the transport boundary on the final tool-budget request;
- existing workflow, durable recovery, evidence JSON, and context-compaction contracts remain green after the cache change.

Cache is acceleration-only. A cache hit is never evidence and never authorizes completion, mutation, promotion, or a quality claim. Revision binding, evidence validation, output validation, `AI_CORE_OUTPUT_TRUNCATED`, deterministic verification, Local Reviewer, External Final Review, and Strict Completion all remain authoritative.

Researcher A→E durable Work Unit reuse is implemented. A general Block Core execution path across every workflow is not connected and remains a separate unfinished capability.

## AI Core resource and speed gate

AI Core resource pressure was independently diagnosed and corrected with Master authorization. Last measured authority remains:

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

Historical observed cache/timing measurements on fa690041 are recorded in `CURRENT_STATE.md`. Complete qualification must record cache hit/miss, prompt-eval time, decode time, role wall time, prefix stability, prompt/completion tokens, and RAM/cgroup events. A speed improvement is valid only when deterministic and semantic quality gates do not regress; broader semantic-quality improvement is not yet proven.

The last measured live context remains 8192. Prompt caching does not enlarge `n_ctx`. A larger live context is a separate Server/resource candidate and must not be promoted from model-native context specifications alone; it requires measured RAM, cache behavior, prompt-eval/decode speed, quality, and end-to-end latency plus separate Master approval.

## Source-side qualification order

Repository source must provide deterministic runners/contracts for:

1. exact-head repository verification/CI;
2. Local Reviewer real-role benchmark;
3. six-role Skill ON/OFF suite;
4. resumable/checkpointed six-role measurement orchestration;
5. one-variable Model A/B harness;
6. exact live source/runtime readback;
7. MCP durable-continuation handoff;
8. Search Gate read-only shadow assessment;
9. context-pressure compaction and evidence rehydration;
10. model-profile output ceiling plus qualified runtime-context clamp;
11. explicit prompt-cache request and provider cache telemetry parsing;
12. stable-prefix and canonical-user compatibility under the Tool Loop.

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

A result of `source_ready=true` means only that the entry points/contracts exist and are coherent. Cache regressions are also directly covered by the repository test suite even though they are not promoted into a live measurement by this source audit.

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

### Deployed resumable behavior and historical low-cap measurement

The deployed b30649a runner preserves OFF/ON progress and checkpoints on the existing runtime volume. Completed unit reuse, failed-unit retry, and incompatible-source rejection remain required; production promotion is never authorized by the measurement runner.

The first real resumable suite on approved Server revision `b30649a19cd97929a595c639f51fae44c74d4185` returned RC=1 / completed=false / INCOMPLETE: five roles measured and Diagnoser failed at `competing_falsifiable_hypotheses / OFF / AI_CORE_EMPTY`.

| Role | Skill OFF | Skill ON | Result |
| --- | ---: | ---: | --- |
| code_scout | 8/15 | 15/15 | SKILL_ON |
| causal_scout | 3/15 | 3/15 | TIE |
| researcher | 19/25 | 17/25 | SKILL_OFF |
| diagnoser | not completed | not completed | INCOMPLETE / AI_CORE_EMPTY |
| patch_engineer | 9/20 | 9/20 | TIE |
| local_reviewer | 15/15 | 15/15 | TIE |

Metadata-only reproduction established token exhaustion with thinking=true: at 600 tokens, finish_reason=length and content_chars=0; at 800 tokens, finish_reason=length and content_chars=410 with incomplete JSON. A benchmark-only 1024-token candidate returned finish_reason=stop, completion_tokens=911, and complete JSON. Its OFF score was 0/5. The patched intermediate source also completed the previously unexecuted ON unit with finish_reason=stop, 970 completion tokens, and score 1/5. These are repair diagnostics for one case, not a role winner, full-suite measurement, or current production policy.

Further candidate measurement on source `1e7d907ca706068a7d8cb20e790750e961548050` failed at `cross_refutation / OFF`: HTTP 200, finish_reason=length, 1024 completion tokens, and only 2 visible characters. A one-variable benchmark-only 1536-token candidate completed that unit at 1292 completion tokens with finish_reason=stop and complete JSON, scoring 1/5. The 1536 candidate later completed 7/8 modes and failed at correlation_insufficient/ON: finish_reason=length, completion_tokens=1536, content_chars=382, reasoning_chars=7166. Its role measurement remains INCOMPLETE, with no total/winner. The isolated failed-ON retry at 2048 completed; seven DONE 1536 modes are preserved and are not remeasured or merged across budgets.

The intermediate fixed-2048 correction kept `AI_CORE_OUTPUT_TRUNCATED` fail-closed and proved that the historical low allowance could truncate valid work. Source `c9aa6f28...` preserves the model-profile policy and adds cache/context-speed behavior without reintroducing low output caps. Historical 1024/1536/2048 diagnostics remain evidence, not current limits.

| Diagnoser case | 1536 OFF | 1536 ON |
| --- | ---: | ---: |
| competing_falsifiable_hypotheses | 1/5 | 0/5 |
| cross_refutation | 1/5 | 0/5 |
| rejected_hypothesis_avoidance | 0/5 | 3/5 |
| correlation_insufficient | 1/5 | INCOMPLETE / AI_CORE_OUTPUT_TRUNCATED |

The isolated correlation_insufficient/ON retry at 2048 completed with finish_reason=stop, 1205 completion tokens, complete JSON and score 1/5. This lower observed token count does not establish a deterministic minimum allowance or guarantee all future calls. No aggregate/winner combines the 1536 and 2048 records.

Historical candidate/checkpoint records remain immutable historical evidence and must not be rebound to a different source fingerprint.

Model A/B Source contract reproduction showed that the old real client accepted a visible JSON response marked finish_reason=length. The current caller and injected-call measurement boundary reject it as `AI_CORE_OUTPUT_TRUNCATED` and use the canonical choice-level finish reason. Current-source real Thinking/Sampling/Token-cap A/B remains NOT_EXECUTED.

Live MCP stdio on approved b30649a passed initialize, the exact ordered nine-tool list, and real health delegation. No approval/apply shortcut was exposed. Full analyze/start/resume/wait/status/inspect continuation remains NOT_VERIFIED for the current source.

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
1. require exact candidate-head GitHub CI PASS for the sandbox fixture/typed telemetry-retention corrections
2. obtain separate Master approval for that exact new SHA; preserve the approved live 83424901502491c6b1dcc8fd223990f91a750d7d until then
3. reflect only the approved candidate while preserving both volumes, checkpoints, unmanaged state and existing auxiliary containers
4. reverify exact parity; retained runs may continue only when source-bound compatibility and resumable status both hold
5. retain canonical Causal Scout closure evidence; finish semantic quality and sandbox compatibility without relaxing validation or safety
6. finish serial Local Reviewer/cache qualification and keep contested samples labeled
7. use a separate compatible source-bound checkpoint for current six-role Skill ON/OFF measurement
8. retain Skill OFF wins/ties; run Thinking A/B only for explicit boolean roles
9. perform Sampling A/B one axis at a time and token-cap optimization only from prior evidence
10. complete real integration, MCP durable continuation, self-debug, read-only Search shadow and Strict Completion
```

## Completion states

```text
SERVER_CORE_AUTHORITY_READ=PASS|FAIL
CURRENT_SOURCE_BEHAVIOR_CI=PASS|FAIL|NOT_VERIFIED
CURRENT_SOURCE_DOCUMENT_SYNC=PASS|FAIL|IN_PROGRESS
CURRENT_SOURCE_SERVER_REFLECTION=PASS|FAIL|NOT_EXECUTED
CURRENT_RUNTIME_EXACT_PARITY=PASS|FAIL|NOT_VERIFIED
PRE_SERVER_HARNESS_SOURCE=PASS|FAIL
CONTEXT_PRESSURE_85_SOURCE=PASS|FAIL|NOT_VERIFIED
CONTEXT_PRESSURE_85_LIVE=PASS|FAIL|NOT_EXECUTED
PROMPT_CACHE_EXPLICIT_SOURCE=PASS|FAIL|NOT_VERIFIED
PROMPT_CACHE_TELEMETRY_SOURCE=PASS|FAIL|NOT_VERIFIED
PROMPT_CACHE_LIVE_MEASUREMENT=PASS|FAIL|NOT_EXECUTED
TOOL_LOOP_PREFIX_STABILITY_SOURCE=PASS|FAIL|NOT_VERIFIED
MODEL_PROFILE_OUTPUT_CEILING_SOURCE=PASS|FAIL|NOT_VERIFIED
RUNTIME_CONTEXT_CLAMP_SOURCE=PASS|FAIL|NOT_VERIFIED
TRUNCATION_FAIL_CLOSED_SOURCE=PASS|FAIL|NOT_VERIFIED
LIVE_RUNTIME_CONTEXT_ABOVE_8192=MASTER_AUTHORIZED|NOT_AUTHORIZED_NOT_EXECUTED
GENERAL_BLOCK_CORE_ALL_WORKFLOWS=IMPLEMENTED|NOT_CONNECTED|NOT_VERIFIED
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
