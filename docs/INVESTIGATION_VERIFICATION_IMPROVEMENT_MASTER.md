# DebugAI Investigation / Verification Improvement Master — 2026-10-07

Status: DESIGN AUTHORITY FOR INVESTIGATION / VERIFICATION ONLY  
Code generation / Patch Engineer semantic improvement: DEFERRED

## 1. Fresh Current checked before this design

Fresh branch HEAD at design start: `3c403a0a5f8bda91d9cfcdac6eb02d02add8988d`.

Current code paths reviewed:
- `server/roles.js`
- `server/control/model-profiles.js`
- `server/control/role-runtime-budgets.js`
- `server/control/invocation-compiler.js`
- `server/control/role-contracts.js`
- `server/control/role-output-validator.js`
- `server/control/tool-loop.js`
- `server/control/skill-registry.js`
- `server/control/production-skill-procedures.js`
- `server/adapters/ai-core.js`
- `server/control/model-ab-benchmark.js`
- role-specific skill-effect benchmark modules
- `server/workflow.js`
- `compose.yaml`

Do not implement from this document without re-reading Fresh HEAD first. Parallel work may advance the branch.

## 2. Baseline evidence

50-case investigation/verification benchmark:
GitHub Actions run `37608576657`.

Execution:
- DONE 21/50
- AI_CORE_TIMEOUT 18/50
- FORMAT_CONTRACT 9/50
- AI_CORE_BUDGET_EXHAUSTED 1/50
- AI_CORE_HTTP 1/50

Independent semantic grade of DONE outputs:
- PASS 14
- PARTIAL 5
- FAIL 2

Runtime completion by role:
- Causal Scout 10/10
- Researcher 7/10
- Diagnoser 2/10
- Local Reviewer 2/10
- Code Scout 0/10

Important qualification:
Code Scout's 9 format failures are not valid evidence of production capability because the first benchmark schema did not match the production semantic validator.

Successful-output latency (n=21):
- mean ~296.2s
- median ~232.3s
- P90 ~545.1s
- P95 ~571.4s
- min ~91.8s
- max ~572.8s
- mean queue wait ~177.1s
- mean upstream model wall ~119.0s

## 3. Current role/model assignment

- Code Scout: Qwen2.5-Coder-7B-Instruct Q4_K_M
- Causal Scout: Qwen3-8B Q4_K_M, thinking=false
- Researcher: Granite-4.2-8B Q4_K_M, thinking=false
- Diagnoser: Qwen3-8B Q4_K_M, thinking=true
- Local Reviewer: Ministral-3-8B-Reasoning-2512 Q4_K_M
- Patch Engineer: Qwen2.5-Coder-7B-Instruct Q4_K_M (out of current implementation scope)

Observed local generation rates recorded in model profiles:
- Coder: 14.66 tok/s
- Qwen3: 4.18 tok/s
- Granite: 5.82 tok/s
- Ministral: 7.98 tok/s

## 4. Confirmed model-characteristic mismatch

### 4.1 Qwen3
Official authority: https://huggingface.co/Qwen/Qwen3-8B

Official guidance:
- thinking=true: temperature=0.6, top_p=0.95, top_k=20; greedy decoding is explicitly discouraged because it can degrade performance and cause endless repetition.
- thinking=false: temperature=0.7, top_p=0.8, top_k=20.

Current DebugAI production AI Core:
- temperature defaults to 0 for every role.
- top_p/top_k are not sent by normal AI Core calls.
- enable_thinking is correctly sent from the role mapping.

Interpretation:
- Causal Scout non-thinking is operationally strong in the 50-case baseline and must not be changed blindly.
- Diagnoser thinking has severe runtime completion problems and current greedy-like configuration is contrary to Qwen3 official guidance.
- Existing `model-ab-benchmark.js` already contains the official Qwen3 candidates. Use it before promotion.

### 4.2 Qwen2.5-Coder
Official generation config:
https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct/blob/main/generation_config.json
- do_sample=true
- temperature=0.7
- top_p=0.8
- top_k=20
- repetition_penalty=1.1

Current production:
- temperature=0
- normal AI Core path does not send top_p/top_k/repetition_penalty.

Current scope:
- only Code Scout is relevant now; Patch Engineer changes remain deferred.
- Code Scout production/benchmark contract mismatch must be repaired before judging model capability.

### 4.3 Granite 4.2 8B
Official authority:
https://huggingface.co/ibm-granite/granite-4.2-8b

Official guidance:
- temperature=1.0
- top_p=0.95
- do_sample=true
- non-thinking recommended max_new_tokens=2048
- thinking recommended max_new_tokens=8192
- supports thinking/non-thinking/low-effort.

Current DebugAI Researcher:
- thinking=false
- temperature=0
- max_tokens is derived from the model/context hard ceiling, not a normal role output ceiling.

Interpretation:
Researcher already shows usable quality but current sampling/output budget is not aligned with official inference guidance. Existing model A/B must qualify the production change.

### 4.4 Ministral 3 8B Reasoning
Official authority:
https://huggingface.co/mistralai/Ministral-3-8B-Reasoning-2512

Official examples use:
- temperature=0.7
- top_p=0.95
- a model-specific SYSTEM_PROMPT.txt
- a reasoning parser / reasoning_content path
- very large model context is available but the card explicitly notes smaller runtime max length can be used for memory/latency.

Current DebugAI Local Reviewer:
- generic DebugAI system prompt is sent directly.
- AI Core consumes `message.content`; explicit reasoning_content handling is not present.
- model-specific system-prompt/reasoning-parser compatibility with llama.cpp+llama-swap is NOT_VERIFIED.

Action:
Do not copy the external SYSTEM_PROMPT blindly into DebugAI. First qualify how the local GGUF/chat template exposes reasoning content and whether final JSON remains clean.

## 5. Confirmed prompt/validator/handoff mismatches

### Code Scout
Production Workflow prompt says only:
- compact JSON
- small arrays
- no prose

It does not specify exact fields.
Production validator accepts one of:
- facts
- claims
- locations
- source_facts

Existing Code Scout benchmark instead uses:
- relevant_files
- call_path
- contract_mismatch
- excluded_files
- unknowns

This is a harness contract mismatch. Do not classify the initial 0/10 as model failure.

### Causal Scout
Production has an explicit evidence-bound claims protocol.
50-case runtime completion: 10/10.
Do not redesign this role until other failing roles are fixed.

### Researcher
Production Workflow already defines exact fields:
- research_status
- answer
- evidence_refs
- rejected_source_refs
- contradictions
- bound_version

Researcher has the strongest explicit non-review output protocol after Causal Scout.

### Diagnoser
Existing Diagnoser benchmark defines:
- diagnosis_status
- hypotheses
- confirmed_root_cause
- unsupported_claims

Production validator currently accepts:
- hypothesis
- diagnoses
- confirmed_root_cause
- unsupported_claims
- claims

`hypotheses` plural is missing from the semantic rule.
Workflow prompt also does not state the exact Diagnoser fields.
This is a confirmed harness inconsistency.

`pickDiagnosisStatement()` reads:
- public_statement
- hypothesis
- diagnoses[0].hypothesis

It does not read the benchmark's `hypotheses[]` form, so a benchmark-compatible Diagnoser result can degrade the downstream public hypothesis summary.

### Local Reviewer
Central output protocol already explicitly defines:
- verdict
- decision
- claims

Do not redesign the output contract first. Qualify runtime/model usage first.

## 6. Confirmed runtime issues

### 6.1 One global AI Core queue
`server/adapters/ai-core.js` owns one `queueTail`, serializing all role calls.

Do not remove it blindly. llama-swap resource behavior under concurrent local model execution is not yet qualified.

### 6.2 Queue wait consumes execution deadline
For no-tool role execution:
- Tool Loop creates `deadlineAt = now + turn_timeout_ms`.
- AI Core waits on global queue.
- after dequeue, `resolveEffectiveTimeoutMs()` uses remaining time to the original deadline.

Therefore infrastructure queue time can consume the model's execution budget.
Baseline contains direct examples where queue wait dominates total wall time.

Required design:
- explicit queue wait budget
- explicit model execution budget
- independent total workflow wall budget
- separate timeout classes and telemetry.

### 6.3 Physical ceiling is used as normal role request ceiling
`role-runtime-budgets.js` currently takes `max_tokens` from the model output hard ceiling.

Examples:
- Qwen3 native ceiling 32768
- Granite 131072
- Ministral 262144
- Coder declared generation ceiling 8192

These are model/context capability ceilings, not task-appropriate normal output budgets.

Required design:
- keep physical hard ceiling unchanged
- introduce role normal output ceiling separately
- qualify by A/B and observed completion-token distribution
- on truncation, bounded escalation rather than universal huge default.

## 7. Existing assets that MUST be reused

Do not build replacements for:
- Evidence Registry
- Active Evidence Window
- Context Compression
- Durable continuation
- Tool Loop
- Progress Controller
- RuntimeEvidence
- Sandbox verification
- Local Reviewer
- Strict Completion Gate
- Skill-effect benchmarks
- Model A/B benchmark
- Server Command / GitOps safety boundaries

## 8. Improvement sequence

### P0 — Contract correctness
1. Align Code Scout production prompt / validator / benchmark schema.
2. Align Diagnoser production prompt / validator / benchmark schema.
3. Preserve Causal Scout production protocol.
4. Preserve Researcher exact field protocol.
5. Keep Local Reviewer output contract unchanged.

### P0 — Runtime timing
1. Add queue wait timeout/budget separate from role execution timeout.
2. Preserve global serialization initially.
3. Record queue timeout separately from model timeout.
4. Preserve total workflow wall protection.

### P0 — Model characteristic qualification
Use existing `model-ab-benchmark.js`; change exactly one axis per experiment.
Priority:
1. Diagnoser Qwen3 thinking: temperature 0 -> official 0.6.
2. Diagnoser: top_p 0.95.
3. Diagnoser: top_k 20.
4. Researcher Granite: temperature 1.0.
5. Researcher: top_p 0.95.
6. Local Reviewer Ministral: temperature 0.7 then top_p 0.95.
7. Code Scout Qwen2.5-Coder: only after its contract is valid; temperature 0.7, top_p 0.8, top_k 20.

Do not change Causal Scout until its existing strong baseline has been used as a regression control.

### P1 — Role normal output ceilings
Initial measurement candidates only, not production constants:
- Code Scout: 2048
- Causal Scout: 1024
- Researcher: 1024 or official non-thinking 2048 comparator
- Diagnoser: 2048
- Local Reviewer: 1024

Promote only if semantic quality does not regress and timeout/latency improves.

### P1 — Model-specific runtime qualification
- Verify Qwen3 thinking content handling.
- Verify Granite non-thinking flag is actually honored by local chat template.
- Verify Ministral reasoning_content / final content behavior through llama.cpp+llama-swap.
- Record effective_thinking_confirmed and effective_temperature_confirmed only after runtime evidence.

### P2 — Scheduling
Only after queue/execution timing is separated:
- measure per-model concurrency=1 vs bounded 2
- do not remove global queue without resource evidence
- if parallelism helps, use model-aware semaphore/scheduler rather than unbounded concurrency.

## 9. External engineering evidence

Relevant research:
- SWE-agent: Agent-Computer Interfaces materially affect software-engineering agent performance: https://arxiv.org/abs/2405.15793
- Agentless: simple localization -> repair -> validation workflows can compete with more complex agents while reducing cost/complexity: use as a design reference, not a direct architecture replacement.

Principle applied to DebugAI:
keep the strong investigation/evidence machinery, but make the model-facing interface small, explicit, role-specific, and mechanically validated.

## 10. Success gates

Investigation/verification is not considered improved merely because CI passes.

Required runtime evidence:
- format/contract failures materially reduced
- AI_CORE_TIMEOUT materially reduced
- semantic PASS/PARTIAL rate not regressed
- Causal Scout baseline not regressed
- queue_wait no longer consumes model execution allowance
- p50/p90/p95 latency improved or explained by explicit queue vs execution telemetry
- UNKNOWN / INSUFFICIENT_EVIDENCE calibration preserved
- no mutation/apply/deploy regression
- no code-generation semantic changes in this workstream


## 11. GPT CHAT independent A/B client error redaction CU (2026-10-09)

**Owner/scope:** Master assigned Composer the existing external Groq/Gemini free-quota, Host/branch-duplication reconciliation. GPT CHAT separately owns `PR #70` branched **exactly from product PR69 commit `82e3abdd9fe30247d05859b497ffd12f2be2eae8`**, touching only this model-benchmark design, existing `server/control/model-ab-benchmark.js` and existing `server/tests/model-ab-benchmark.test.cjs`. No Server parent/sibling/worktree was created. This is an independent product AI-control hygiene fix, not another Model A/B owner or benchmark redesign; one mutation writer per owned CU.

**G1 Source finding:** `makeAiCoreCaller()` included the first 300 characters of an untrusted, non-2xx AI Core response body in a thrown Error. The same function passed raw malformed HTTP200 text to JSON.parse, whose syntax error message may reveal upstream bytes. Such text may contain raw context, credentials or fragments of private model input and be propagated into workflow/evaluation logs. The code path is independently auditable; **there is no claim a real credential was leaked**.

**Narrow remediation:** Do not read HTTP error bodies at all; on non-2xx emit only a stable `AI_CORE_HTTP_<status>` code. Fail-closed on a successful HTTP response with unreadable or malformed JSON using `AI_CORE_ENVELOPE_READ_FAILED` or `AI_CORE_ENVELOPE_INVALID`, with no untrusted upstream text or causal data copied into the exception. Existing role selection, prompt, sampling, temperature, A/B score/holdouts and `AI_CORE_OUTPUT_TRUNCATED` semantics remain byte-identical. Do not change the protected production calling path, provider, model, backend or Secrets. A static error code is adequate for a read-only benchmark and preserves HTTP categorization.

**Fail-first verification:** Two mock-response regressions added first on separate new branch commit `405ad0aabd17faa6573f4712c6aa21134bbbc5ff`: (1) HTTP503 body deliberately contains synthetic Bearer and private marker, must not appear in error fields; (2) HTTP200 malformed JSON body contains private marker, must return a typed opaque error. Both are test-only, no network requests to AI services. The repair is the existing function (not a duplicate API client), commit `4438db51ed863e3b9668d2c3f665b8ee707e5c53`.

**Acceptance and state separation:** Full benchmark negative+positive tests and exact-head Verify/Core/Public/Volume must be read back before PASS. This isolates a **logging privacy weakness**; it is not evidence of an A/B semantic quality gain, real AI Runtime capability, credential billing status, model config optimization or a paid provider invocation. Further required genuine semantic 50/60 evaluation remains unchanged. Rollback: revert this one existing A/B function, two regression tests and this Design Delta; no stored schemas, model settings or external behavior contract change outside the benchmark client.


## 12. GPT CHAT Model A/B exact-completion contract — 2026-10-09 independent continuation

**Reason and evidence**: After the prior Model A/B response-error redaction G3, an independent source audit found that `assertCompleteReply()` rejected only `finish_reason=length`. Other incomplete result markers — `content_filter`, `tool_calls`, `function_call`, missing/null and unrecognized statuses — were accepted as syntactically valid JSON and passed to semantic scoring. This is a **false-quality-PASS measurement vulnerability**, not an assertion that production models issued such a reply. The contract applies to existing Model A/B client (not production AiCore, not a second validator).

**G1/G2 measured fail-first**: Two negative regressions committed `0d7e111649b5f8a4c3c76de1b329c09dce8ae2eb` on the same existing owned Draft PR70 before source modification. [Exact test-only Verify](https://github.com/seigo-gace/debug-ai/actions/runs/37914191100) **FAILED 586/588 PASS, 2 FAIL, 0 SKIP**; one tests upstream HTTP200 with a valid-looking JSON body but incomplete/missing finish_reason, other tests an injected benchmark caller returning valid-looking scored JSON with content_filter. These tests verify both the remote-client and scoring paths.

**Narrow fix**: Extend the SAME `assertCompleteReply()` to accept `finish_reason=stop` as a measured completed response, preserve the existing explicit `length -> AI_CORE_OUTPUT_TRUNCATED` with its safe metadata, and fail closed on all other finish states with stable `AI_CORE_OUTPUT_NOT_COMPLETE`. Metadata exposes only recognized safe finish labels, never opaque unknown provider text; role, output max tokens, token count and length remain measured when available. No prompt/model/temperature/tool/runtime/deploy change, no calls to a model, no additional checker/validator. Exact source commit `993c9fe2a23c310a555137a365aa0b3ffef867d3`.

**Acceptance**: Both fail-first tests pass after the fix, existing `stop` and `length` tests stay green, real Sidecar and all applicable exact-head CI succeed, and source/doc remote readback matches. If an upstream model uses a nonstandard confirmed complete marker, qualify it with **actual provider/runtime evidence** in a separate CU; do not silently score unknown/filtered/tool-handoff results as successfully finished. No claim of higher real-model semantic accuracy or live A/B measurement. Rollback only within this owned benchmark client/tests/Design; Composer's separate PR69 free-tier ledger and Host branch reconciliation remain untouched.
