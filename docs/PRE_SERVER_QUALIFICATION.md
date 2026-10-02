# DebugAI Pre-Server Qualification

## Purpose

Separate source-complete measurement logic from real Server/model/runtime measurements. Source readiness must never be relabeled as a live PASS.

Read [`CURRENT_STATE.md`](CURRENT_STATE.md) for the current source/runtime boundary.

Server/VPS/Docker mutation is governed by current `G-ACE-inc/server-core` authority plus explicit Master authorization.

## Current source qualification anchor

The current Local Reviewer claim-type contract repair source anchor is:

```text
0ad40ea939866c9ae59086c1030aadd3f76bdb4a
```

Exact qualification observed at that anchor:

```text
Public Readiness Audit #380      = SUCCESS
Verify #415                      = SUCCESS
repository tests                 = 381/381 PASS
Dependency Review                = SUCCESS
Legacy Authority                 = SUCCESS
Runtime Volume Gate #16          = SUCCESS
Core Verify #416                 = SUCCESS
pre-server source audit          = source_ready=true / READY
runtime-image qualification      = PASS
MCP source/stdio                 = PASS / exact nine tools
```

The source audit deliberately reports real model/integration/MCP/Search measurements separately. Source/CI PASS does not promote an unreflected or failed real role benchmark to PASS.

Documentation commits following this anchor require their own exact-head CI before Server reflection.

## Current live precondition

Latest verified DebugAI Server reflection:

```text
Server checkout                  = ebe48131b236d8ca44057c813236fd0e99925214
Runtime                          = healthy
runtime-init                     = Exited (0)
sandbox-init                     = Exited (0)
sandbox-runner                   = Up
loopback /health                 = PASS
tracked worktree                 = CLEAN
.debugai-input                   = preserved
source parity                    = PASS for deployed ebe48131 source
pre-server qualification         = source_ready=true / READY
Current 0ad40ea source           = not yet reflected
LIVE_RUNTIME_SOURCE_STATE        = RUNTIME_SOURCE_BEHIND_OR_UNKNOWN for current HEAD
Search Gate shadow               = NO_SHADOW_RECORDS / NOT_EVALUABLE
Search skip activation           = NO
```

Master authorized Current DebugAI source reflection/build/recreate after README/document synchronization. That mutation phase remains separate from measurement claims and must follow current server-core rules.

AI Core resource pressure was independently diagnosed and corrected with Master authorization. Current four backend limits are 9 GiB each, `ai-core.slice` is `MemoryHigh=34G / MemoryMax=36G`, and a final 128-token Ministral retest produced no new High/Max/OOM/OOM-kill events. DebugAI timeout was not extended as a workaround.

## Source-side qualification order

Repository source must provide deterministic runners for:

1. exact-head repository verification/CI;
2. Local Reviewer real-role benchmark;
3. six-role Skill ON/OFF suite;
4. one-variable Model A/B harness;
5. exact live source/runtime readback;
6. MCP durable-continuation handoff;
7. Search Gate read-only shadow assessment.

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

The validator remains fail-closed. The repair changes the invocation contract so the real model receives the same schema the validator already enforces.

Regression coverage includes:

- canonical `verdict / decision / claims` protocol in Local Reviewer invocation;
- canonical claim `type` field and allowed uppercase values in invocation;
- noncanonical `review_state/material_claims` output rejected;
- missing canonical `decision` rejected;
- unregistered evidence reference rejected;
- real failure family `{claim,evidence_refs,support}` without `type` rejected with `CLAIM_TYPE_INVALID`;
- existing `UNKNOWN and INSUFFICIENT_EVIDENCE are valid` non-fabrication boundary preserved.

## Measured Local Reviewer history

The measurement history must remain separated by cause and source revision.

### AI Core constrained state

An early real Local Reviewer run timed out at 600000 ms while AI Core memory ceilings caused severe backend reclaim. After the authorized resource correction, Ministral speed returned to roughly 6–7 tok/s and cgroup High/Max/OOM deltas returned to zero for the tested serial path.

This timeout cause is closed and the DebugAI timeout remains unchanged.

### Noncanonical top-level output

After resource correction, one run returned `ROLE_OUTPUT_JSON_INVALID`. A RAW recapture then produced complete JSON but used:

```text
review_state
review_evidence
material_claims
final_review_state
```

instead of the Production Workflow canonical `verdict / decision / claims` contract. The source was tightened and that repair was later reflected at Server revision `ebe48131...`.

### Repeatable claims-item type failure on ebe48131

On live Server revision `ebe48131b236d8ca44057c813236fd0e99925214`, the canonical Local Reviewer benchmark was executed three consecutive times.

```text
run 1 = FAIL / ROLE_CLAIM_EVIDENCE_INVALID / CLAIM_TYPE_INVALID on claims 0..3
run 2 = FAIL / ROLE_CLAIM_EVIDENCE_INVALID / CLAIM_TYPE_INVALID on claims 0..2
run 3 = FAIL / ROLE_CLAIM_EVIDENCE_INVALID / CLAIM_TYPE_INVALID on claims 0..2
AI Core HIGH/MAX/OOM/OOM_KILL delta = 0 on every run
```

This is a real repeated contract failure, not a source-only assumption and not renewed AI Core memory pressure.

The root cause was that the prompt required a claims array but did not explicitly name the mandatory `type` field and its allowed values. Unit fixtures manually supplied `type:"FACT"`, hiding the real-model gap.

Current source `0ad40ea...` fixes that prompt contract and passes exact source CI, but the repair is not yet reflected to the live Server. Therefore:

```text
LOCAL_REVIEWER_REAL_CURRENT_RUNTIME = FAIL
LOCAL_REVIEWER_CLAIM_TYPE_FIX_SOURCE = PASS
LOCAL_REVIEWER_CLAIM_TYPE_FIX_LIVE = NOT_VERIFIED
```

## Live runtime readback

```bash
npm run audit:live-runtime
```

This is read-only. It verifies repository identity, bounded Git state, production entrypoint/workdir, exact Host↔Container measurement-source parity, DebugAI health identity, and safe preconditions for read-only Search Gate shadow evaluation.

If Host Node/npm is absent, do not relabel the CLI as executed. Equivalent constituent read-only gates may be measured independently, but the CLI state remains `NOT_EXECUTED`.

If source/runtime is incompatible, preserve:

```text
LIVE_RUNTIME_SOURCE_STATE=RUNTIME_SOURCE_BEHIND_OR_UNKNOWN
```

Do not invent a live measurement.

## Local Reviewer benchmark

```bash
npm run benchmark:local-reviewer
```

This uses the real current role path through AI Core. A unit test does not replace a real result.

Qualification requires at minimum:

```text
completed=true
contract.validated=true
strict_evidence_refs=true
canonical verdict present
canonical decision present
claims is an array
every claims[] item has a valid canonical type
evidence binding valid
successful process exit
```

After current source reflection, run the benchmark repeatedly. The immediate stability gate is three consecutive real passes with zero new AI Core High/Max/OOM/OOM-kill events. A single lucky pass does not close a previously repeatable 3/3 failure.

## Six-role Skill ON/OFF suite

```bash
npm run benchmark:skill-effect-all
```

Fixed order:

```text
code_scout
causal_scout
researcher
diagnoser
patch_engineer
local_reviewer
```

Rules:

- same role/model/fixed cases;
- Skill ON is not assumed better;
- Skill OFF wins and ties are valid;
- one missing/failing role makes the suite incomplete;
- do not start the suite while the Local Reviewer canonical real gate is unresolved;
- no production promotion authority.

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

Each pair fixes:

```text
same backend model
same fixed benchmark case
same input
same Skill-ON system
exactly one changed axis
counterbalanced baseline/candidate order
dynamic score ceiling from the role scorer
```

Baseline:

```text
thinking    = current role contract
temperature = 0
top_p       = unspecified/provider baseline
top_k       = unspecified/provider baseline
max_tokens  = current role runtime budget
```

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

Official reference authorities remain the repository-recorded Qwen/Qwen3/Granite/Ministral model guidance and llama.cpp server sampling contract. A recommendation is a measurement candidate, not automatic production configuration.

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

Provider usage remains null when the provider does not return measured token counts.

## Real integration qualification

After exact Current runtime parity and a stable Local Reviewer gate:

```text
AI Core real calls
TGserver real path when the chosen case requires it
Astera Evidence Search real path when the chosen case requires it
real allowed repository
Durable continuation
MCP parent-agent path
Search Gate shadow evidence
```

Do not manufacture provider traffic solely to mark a box PASS. Choose a representative case if a dependency's live path separately requires qualification.

## Live order after authorized source reflection

```text
current server-core authority
-> preserve local-only Server state
-> exact confirmed GitHub revision reflection
-> Docker build/recreate only required DebugAI services
-> /health + command/workdir + source parity
-> audit:pre-server-qualification
-> audit:live-runtime where executable
-> Local Reviewer canonical real benchmark x3
-> require valid claims[].type and evidence binding on every pass
-> six-role Skill ON/OFF
-> Thinking A/B only where explicit boolean
-> Sampling A/B with justified candidates
-> token-cap A/B after prior evidence
-> real allowed-repository integration
-> MCP durable continuation proof
-> Search Gate shadow measurement
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
MODEL_AB_THINKING_REAL=MEASURED|PARTIAL|NOT_APPLICABLE|NOT_EXECUTED
MODEL_AB_SAMPLING_REAL=MEASURED|PARTIAL|INCOMPLETE|NOT_EXECUTED
MODEL_AB_TOKEN_CAP_REAL=MEASURED|INCOMPLETE|NOT_EXECUTED
REAL_INTEGRATION_E2E=PASS|FAIL|NOT_EXECUTED
MCP_LIVE=PASS|FAIL|NOT_EXECUTED
SEARCH_GATE_SHADOW_REAL=MEASURED|NOT_EVALUABLE|NOT_EXECUTED
PRODUCTION_PROFILE_CHANGE=NONE|MASTER_AUTHORIZED
SEARCH_SKIP_ACTIVATION=NO|MASTER_AUTHORIZED
```

No fixture/source audit may promote an unexecuted or failed real state to PASS.
