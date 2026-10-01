# DebugAI Pre-Server Qualification

## Purpose

Separate source-complete measurement logic from real Server/model/runtime measurements. Source readiness must never be relabeled as a live PASS.

Read [`CURRENT_STATE.md`](CURRENT_STATE.md) for the current source/runtime boundary.

Server/VPS/Docker mutation is governed by current `G-ACE-inc/server-core` authority plus explicit Master authorization.

## Current source qualification anchor

Before this documentation synchronization:

```text
implementation anchor            = c2355f8dd7628e717db1bba83725b33360796828
Public Readiness Audit #359      = SUCCESS
Verify #394                      = SUCCESS
repository tests                 = 373/373 PASS
Core Verify #395                 = SUCCESS
pre-server source audit          = source_ready=true
runtime-image qualification      = PASS
MCP source/stdio                 = PASS
```

The source audit deliberately reports real model/integration/MCP/Search measurements as not executed.

## Current live precondition

Last read-only Server inspection:

```text
old Server checkout              = df261bdae3b6f259ac428a173b798fae2fb68bdf
old Runtime                      = healthy
Current source deployed          = no
Current qualification assets     = absent from old running image
LIVE_RUNTIME_SOURCE_STATE        = RUNTIME_SOURCE_BEHIND_OR_UNKNOWN
```

Master authorized Current DebugAI source reflection after the README/document synchronization. That mutation phase remains separate from the measurement claims below and must follow current server-core rules.

## Source-side qualification order

Repository source must provide deterministic runners for:

1. exact-head repository verification/CI;
2. Local Reviewer real-role benchmark;
3. six-role Skill ON/OFF suite;
4. one-variable Model A/B harness;
5. exact live source/runtime readback;
6. MCP durable-continuation handoff;
7. Search Gate read-only shadow assessment.

`npm run verify` executes the source qualification audit after build/check/tests.

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

## Live runtime readback

```bash
npm run audit:live-runtime
```

This is read-only. It verifies repository identity, bounded Git state, production entrypoint/workdir, exact Host↔Container measurement-source parity, DebugAI health identity, and the safe preconditions for read-only Search Gate shadow evaluation.

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

After exact Current runtime parity:

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
-> exact Current source reflection
-> Docker build/recreate
-> /health + command/workdir + source parity
-> audit:pre-server-qualification
-> audit:live-runtime
-> Local Reviewer real benchmark
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

No fixture/source audit may promote an unexecuted real state to PASS.
