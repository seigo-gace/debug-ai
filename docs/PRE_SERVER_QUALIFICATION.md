# DebugAI Pre-Server Qualification

## Purpose

Separate source-complete measurement logic from real Server/model/runtime measurements. Source readiness must never be relabeled as a live PASS.

Read [`CURRENT_STATE.md`](CURRENT_STATE.md) for the current source/runtime boundary.

Server/VPS/Docker mutation is governed by current `G-ACE-inc/server-core` authority plus explicit Master authorization.

## Source qualification and live boundary

Resumable implementation anchor `9dc8def709ab277bbfb1e6b6701821791bf4dcd8` was followed by documentation revision `b30649a19cd97929a595c639f51fae44c74d4185`, which passed all six required CI checks and was explicitly approved and deployed.

This revision repairs the measured Diagnoser benchmark cap and adds fail-closed truncation classification. Targeted tests: 6/6 PASS; related benchmark/qualification tests: 40/40 PASS. Exact-head CI for this correction must be read back before a new approved reflection. These source tests are not full corrected-source real measurement.

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

## AI Core resource gate

AI Core resource pressure was independently diagnosed and corrected with Master authorization. Current measured authority remains:

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

## Source-side qualification order

Repository source must provide deterministic runners for:

1. exact-head repository verification/CI;
2. Local Reviewer real-role benchmark;
3. six-role Skill ON/OFF suite;
4. resumable/checkpointed six-role measurement orchestration;
5. one-variable Model A/B harness;
6. exact live source/runtime readback;
7. MCP durable-continuation handoff;
8. Search Gate read-only shadow assessment.

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

### Deployed resumable behavior and measured correction

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

Metadata-only reproduction established token exhaustion with thinking=true: at 600 tokens, finish_reason=length and content_chars=0; at the unchanged production allowance of 800 tokens, finish_reason=length and content_chars=410 with incomplete JSON. A benchmark-only 1024-token candidate returned finish_reason=stop, completion_tokens=911, and complete JSON. Its OFF score was 0/5. The patched source also completed the previously unexecuted ON unit with finish_reason=stop, 970 completion tokens, and score 1/5. These are repair diagnostics for one case, not a role winner, full-suite measurement, or quality PASS.

Further candidate measurement on source `1e7d907ca706068a7d8cb20e790750e961548050` failed at `cross_refutation / OFF`: HTTP 200, finish_reason=length, 1024 completion tokens, and only 2 visible characters. A one-variable benchmark-only 1536-token candidate completed that unit at 1292 completion tokens with finish_reason=stop and complete JSON, scoring 1/5. Remaining paired measurements are in progress; this is neither full-suite completion nor a quality PASS.

This source correction fixes the paired Diagnoser benchmark allowance at 1536 and keeps AI_CORE_OUTPUT_TRUNCATED fail-closed. The resumable runner now retains only whitelisted truncation metadata (role, allowance, finish reason, completion tokens, visible character count) in failed-unit checkpoints and clears it after a successful retry. Raw reasoning and provider payloads are excluded. Production Diagnoser remains at 800 tokens. Cases, scorers, models, thinking, temperature, Skill semantics, and production profiles are unchanged. Diagnoser/runner targeted tests passed 12/12; related benchmark/qualification tests passed 43/43. This revision still requires its own exact-head CI and explicitly approved Server reflection.

Candidate diagnostics persist atomically on the existing runtime volume: `/app/runtime/benchmarks/diagnoser-candidate-1e7d907ca706068a7d8cb20e790750e961548050.json` preserves the 1024-token failure; `/app/runtime/benchmarks/diagnoser-candidate-1e7d907-cap1536.json` binds the in-memory 1536 candidate to its module SHA256 and stores each completed mode. Inspect active processes and reuse DONE modes. These diagnostic records must not be seeded into a different source-bound suite checkpoint. An interrupted earlier stream with no recoverable output is NOT counted as completed.

The existing checkpoint remains preserved at `/app/runtime/benchmarks/skill-effect-suite-checkpoint.json`, bound to fingerprint `810356ebbffd98fee5fff0ba1cfbb03613248857ac7ebb4da034236721b38568`. The previous 1e7d correction fingerprint was `019bf433c3299d90769569393fceec23718228ac89663bb4d5fd67c1b663b312`; this revision's source fingerprint is `2008657cb9e067f26ea4045edf6e4624ce64a6feee371f04890134ca3f3ce369`. They are incompatible: do not edit/rebind the old checkpoint or replay it against the corrected source. Use a distinct checkpoint filename on the same existing runtime volume when the new revision is approved. The five completed role results remain historical measurement evidence for b30649a; they are not current corrected-source measurements.

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
