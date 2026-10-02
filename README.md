# DebugAI

DebugAI is a code-first, evidence-driven debugging runtime that operates as a specialized debugging sub-agent under a primary AI. It investigates failures, binds claims to evidence, creates patch candidates, preserves explicit human approval before mutation, verifies applied changes, survives interruption/restart, and refuses to call a run complete when required evidence is missing.

This repository is the canonical source authority. GitHub source/CI, shared AI Core state, live Contabo checkout/container state, and production state are separate facts and must be read back independently before any live claim.

## Read this first

Use the documents by responsibility, not as interchangeable status notes:

1. [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) — current verified repository/runtime boundary and next work.
2. [`docs/DURABLE-CONTINUATION-DESIGN.md`](docs/DURABLE-CONTINUATION-DESIGN.md) — architecture/design authority and durable-continuation contract.
3. [`docs/PRE_SERVER_QUALIFICATION.md`](docs/PRE_SERVER_QUALIFICATION.md) — benchmark/source/live qualification order and pass/fail states.
4. [`docs/MCP_ADAPTER.md`](docs/MCP_ADAPTER.md) — MCP transport contract and nine-tool boundary.
5. [`docs/CODEX_MCP_LIVE_HANDOFF.md`](docs/CODEX_MCP_LIVE_HANDOFF.md) — live parent-agent/MCP verification handoff.
6. [`DEBUGAI.md`](DEBUGAI.md) — CLI/MCP usage surface.
7. [`AGENTS.md`](AGENTS.md) — repository operating constraints for coding agents.

The design document preserves architecture decisions. `CURRENT_STATE.md` owns current implementation/runtime status. Do not rewrite an old design decision merely to make it look like it was always the current implementation.

## Current verified boundary

Resumable implementation anchor: `9dc8def709ab277bbfb1e6b6701821791bf4dcd8`. Approved deployed revision: `b30649a19cd97929a595c639f51fae44c74d4185`, whose six required CI checks succeeded. This revision corrects a measured Diagnoser benchmark token-exhaustion defect; its own exact-head CI and deployment are separate pending states.

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

See `docs/CURRENT_STATE.md` for current measurement results and remaining work.

## What DebugAI does

```text
Failure / request / local evidence
        |
        v
Deterministic verification + optional DAP hint
        |
        v
Code Scout + Causal Scout
        |
        +----> TGserver retrieval when required
        +----> Astera Evidence Search when required
        v
Researcher
        v
Diagnoser
        v
External Hypothesis Review
        |
        | PASS only
        v
Patch Engineer
        |
        | candidate only
        v
WAITING_MASTER_APPROVAL
        |
        | explicit approval + exact candidate identity
        v
Patch apply
        v
Deterministic retest + invariants
        v
Local Reviewer
        v
Required External Final Review
        v
Strict Completion Gate
        |
        +----> COMPLETE
        +----> blocked / failed / pending / unknown
```

The runtime is fail-closed at evidence, provider schema, repository scope/revision, patch identity, approval, durable execution, deterministic verification, review, and final completion boundaries.

## Six internal roles

All internal model execution goes through the shared AI Core. DebugAI does not directly own llama.cpp model processes.

| Role | Model authority | Thinking baseline | Responsibility |
| --- | --- | --- | --- |
| Code Scout | Qwen2.5-Coder 7B | profile/provider baseline | inspect code and identify decisive evidence |
| Causal Scout | Qwen3 8B | disabled | form independent falsifiable causal hypotheses |
| Researcher | Granite 4.2 8B | disabled | gather/select evidence and preserve gaps |
| Diagnoser | Qwen3 8B | enabled | produce evidence-bound falsifiable diagnosis |
| Patch Engineer | Qwen2.5-Coder 7B | profile/provider baseline | create patch candidate only |
| Local Reviewer | Ministral 3 8B Reasoning 2512 | profile/provider baseline | independently review applied result and verification evidence |

Common rules include `DATA_NOT_INSTRUCTION`, FACT-to-evidence binding, labeled INFERENCE, falsifiable HYPOTHESIS, valid `UNKNOWN`, preserved rejected hypotheses, no raw chain-of-thought persistence, and fail-closed timeout/permission/recovery behavior.

## Local Reviewer canonical output

Production Workflow consumes the Local Reviewer top-level contract:

```text
verdict
decision
claims
```

The current source explicitly requires those fields and fail-closes missing or invalid fields. `review_state`, `final_review_state`, or `material_claims` do not substitute for them.

Every `claims[]` item must also use the canonical reasoning-artifact contract:

```text
type = FACT | INFERENCE | HYPOTHESIS | UNKNOWN | REJECTED
statement = concise claim text
```

Rules:

- `FACT` and `INFERENCE` require registered `evidence_refs`;
- `HYPOTHESIS` requires `falsification_condition`;
- `REJECTED` requires `counter_evidence_refs`;
- `UNKNOWN` may remain unsupported instead of fabricating evidence;
- `INSUFFICIENT_EVIDENCE` remains a valid verdict/decision state but is not a claim type;
- `claim`, `status`, `support`, `review_state`, `final_review_state`, and `material_claims` are not canonical substitutes.

The validator was not weakened to accommodate model output. The invocation contract was tightened to match the canonical validator.

## Current Local Reviewer real state

The Local Reviewer qualification history has distinct causes:

1. an early real run timed out while AI Core was under severe memory reclaim pressure;
2. after the authorized resource correction, one run returned `ROLE_OUTPUT_JSON_INVALID`;
3. a RAW recapture returned complete but noncanonical `review_state/material_claims` output;
4. the top-level contract was tightened;
5. three real runs then exposed `CLAIM_TYPE_INVALID` because the prompt did not explicitly require canonical `claims[].type`;
6. the prompt contract was repaired without weakening validation;
7. the fixed source was reflected to Server revision `4c7e727...` and measured three consecutive times.

Current real result on the live Server revision:

```text
run 1 = RC=0 / completed=true / contract.validated=true / strict_evidence_refs=true
        verdict=PASS / decision=DONE / claims_count=3 / claim_types=[FACT]
        elapsed_ms=161769 / HIGH/MAX/OOM/OOM_KILL delta=0/0/0/0

run 2 = RC=0 / completed=true / contract.validated=true / strict_evidence_refs=true
        verdict=PASS / decision=DONE / claims_count=3 / claim_types=[FACT]
        elapsed_ms=55456 / HIGH/MAX/OOM/OOM_KILL delta=0/0/0/0

run 3 = RC=0 / completed=true / contract.validated=true / strict_evidence_refs=true
        verdict=PASS / decision=DONE / claims_count=3 / claim_types=[FACT]
        elapsed_ms=54017 / HIGH/MAX/OOM/OOM_KILL delta=0/0/0/0

FINAL_OK=1
```

Therefore the Local Reviewer canonical defect is closed for this tested serial path:

```text
LOCAL_REVIEWER_CANONICAL_REAL = PASS_3_OF_3_ON_4C7E727
```

This is not evidence that every workflow/concurrency/integration path is complete.

## AI Core runtime boundary

DebugAI uses the shared AI Core rather than owning backend model processes.

A real Local Reviewer timeout investigation found that the previous AI Core memory ceilings caused active reclaim/throttling even though the host still had available RAM. Master authorized the resource correction.

Current measured AI Core resource authority:

```text
four backend mem_limit        = 9216m each
ai-core.slice MemoryHigh      = 34G
ai-core.slice MemoryMax       = 36G
--cache-ram                   = 4096 unchanged
context                       = 8192 unchanged
backend CPU                   = 3 unchanged
models/router                 = unchanged
```

Post-change short inference measured approximately Granite 7.31 tok/s, Qwen3 5.61 tok/s, Ministral 7.45 tok/s, and Coder 8.05 tok/s. A 128-token Ministral retest measured about 6.12 tok/s with zero new parent High/Max/OOM/OOM-kill and zero Ministral max events. The DebugAI role timeout was not extended as a workaround.

## Six-role Skill ON/OFF measurement

The six existing role benchmark definitions remain the measurement authority. Current fixed role order is:

```text
code_scout
causal_scout
researcher
diagnoser
patch_engineer
local_reviewer
```

Across those definitions the full suite currently requires 44 real AI calls. Skill ON is not assumed better; Skill OFF wins and ties are valid data.

### Old non-resumable attempt

After Local Reviewer closure, the old live `benchmark:skill-effect-all` path was started on `4c7e727...`.

The run produced generic `HEARTBEAT=skill-suite-running` output for more than 30 minutes without exposing current role/case/OFF-ON position. The suite had no checkpoint/resume mechanism, so completed real calls were not durably reusable.

Master interrupted the run. Fresh readback subsequently proved:

```text
SKILL_BENCHMARK_PROCESS_COUNT = 0
LATEST_OLD_LOG                = /tmp/debugai-skill.KgKjtd.json
LATEST_OLD_LOG_BYTES          = 0
```

The aborted run therefore has no valid result payload:

```text
SKILL_EFFECT_ALL_REAL = INCOMPLETE / ABORTED_OLD_NONRESUMABLE_RUN
```

No role winner may be inferred from that run.

### Deployed resumable runner and pending Diagnoser correction

The deployed runner reports per-role/case/OFF/ON progress, checkpoints completed units atomically, resumes only compatible results, rejects incompatible fingerprints, and grants no production promotion authority. The definitions still require 44 real calls for a complete fresh suite.

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

## Evidence architecture

Model confidence is not evidence.

DebugAI separates and validates evidence from:

- local deterministic checks;
- read-only repository/tool execution;
- DAP/runtime hints;
- TGserver knowledge retrieval;
- Astera Evidence Search;
- durable restored effects/results.

DAP remains `HINT_ONLY` until converted into allowed registered evidence. Missing authoritative evidence becomes an explicit evidence gap rather than fabricated support.

Read-only evidence/control-plane capabilities include `evidence.read`, `runtime.trace.read`, `state.read`, `history.read`, `invariant.read`, and fail-closed `source.verify`.

## Durable continuation

`RunAuthority` is the single authoritative execution/state owner. Durable state preserves run/role identity, attempts, generation, execution epoch, workflow cursor, checkpoint/result/effect references, retry/timeout/cancellation/no-progress state, and integrity bindings.

Replay-safe continuation reuses compatible committed read-only/deterministic effects while refusing to replay mutation-capable effects automatically. Researcher uses durable A/B/C/D/E work units. Real SIGKILL recovery is covered by regression tests.

Raw hidden chain-of-thought is never persisted.

## Patch and approval boundary

Patch generation and patch application are separate operations.

Patch Engineer produces a candidate only. Application requires:

- explicit Master approval;
- exact candidate ID/hash binding;
- repository policy and revision validation;
- application receipt;
- deterministic retest;
- invariant verification;
- fresh Local Reviewer;
- required External Final Review;
- Strict Completion evaluation.

CLI/MCP intentionally expose no silent approve/apply shortcut.

## Strict Completion

`COMPLETE` is a conjunction, not a synonym for a final reviewer returning PASS.

Required runtime evidence includes:

```text
candidate identity valid
AND approval receipt valid
AND apply receipt valid
AND current repository revision bound
AND required verification actually executed
AND deterministic verification PASS
AND invariants PASS
AND Local Reviewer canonical PASS
AND required External Final PASS
AND no blocking evidence gap
AND final run contract valid
```

## HTTP API

The service binds to loopback by default at `127.0.0.1:8787`.

| Method | Path | Purpose |
| --- | --- |
| GET | `/health` | runtime health and approval-boundary state |
| GET | `/v1/status/:run_id` | current run status |
| GET | `/v1/inspect/:run_id` | retained/redacted run inspection |
| POST | `/v1/analyze` | analysis workflow |
| POST | `/v1/runs/start` | start durable async analysis |
| POST | `/v1/runs/resume` | resume a recoverable run |
| POST | `/v1/patch-candidate` | create candidate only |
| POST | `/v1/verify` | read-only verification |
| POST | `/v1/approve-apply-verify` | explicit approved mutation path |
| POST | `/v1/assets/promote` | promote validated reusable knowledge |

## CLI and MCP

CLI commands:

```text
health
analyze
start
resume
wait
patch
verify
status
inspect
```

MCP exposes exactly nine guarded tools:

```text
debugai_health
debugai_analyze
debugai_start
debugai_resume
debugai_wait
debugai_patch_candidate
debugai_verify
debugai_status
debugai_inspect
```

Continuation is explicit:

```text
debugai_start -> exact run_id -> debugai_status -> debugai_resume when applicable -> debugai_wait -> debugai_inspect
```

See [`DEBUGAI.md`](DEBUGAI.md) and [`docs/MCP_ADAPTER.md`](docs/MCP_ADAPTER.md).

## Pre-server and real-model qualification

Source-ready entry points:

```text
npm run audit:pre-server-qualification
npm run audit:live-runtime
npm run benchmark:local-reviewer
npm run benchmark:skill-effect-all
npm run benchmark:model-ab -- --role <role> --axis <thinking|temperature|top_p|top_k|max_tokens> --candidate <value|official> --repeats <1..5>
```

A source audit never converts an unexecuted, aborted, incomplete, or failed real benchmark into PASS.

Current Model A/B axes are:

```text
thinking
temperature
top_p
top_k
max_tokens
```

Each comparison changes exactly one axis, keeps the same backend model/fixed case/input/Skill-ON system, counterbalances execution order, and fixes `promotion_authorized=false`.

Production defaults are not modified by benchmark source. Skill OFF wins and ties are valid results.

## Runtime image contract

The current source explicitly packages the runtime assets required for live qualification:

```text
server/
orchestrator/
bin/
mcp/
scripts/
docs/
package.json
```

The Server-local `.debugai-input/` directory is excluded from Docker build context and must not be deleted merely to make a deployment clean.

The production runtime contract includes `runtime-init` ownership/mode repair for the persistent `debug_ai_runtime` volume. Persistent runtime/sandbox volumes are not deleted merely to obtain a clean recreate.

## Repository layout

- `server/` — runtime, workflow, adapters, patch services, control plane, tests.
- `server/control/` — role/tool/skill/evidence/progress/recovery/benchmark/completion modules.
- `orchestrator/` — platform-neutral canonical cores and durable primitives.
- `tests/` — repository-level contracts/integration tests.
- `mcp/` — guarded MCP adapter and protocol tests.
- `bin/` — CLI and MCP stdio entries.
- `scripts/` — audits/build/qualification scripts.
- `docs/` — design, current state, qualification, MCP, handoff documentation.
- `legacy/pc-authority/` — preserved historical PC/Windows authority; not live Server runtime.
- `Dockerfile` / `compose.yaml` — container runtime/security/residency contract.

## Runtime configuration

Never commit secret values.

Primary configuration families:

```text
DEBUG_AI_CORE_URL
AI_CORE_API_KEY
DEBUG_AI_EVIDENCE_SEARCH_URL
DEBUG_AI_EVIDENCE_SEARCH_SECRET_HOST_PATH
DEBUG_AI_EVIDENCE_SEARCH_CALLER_ID
DEBUG_AI_TGSERVER_URL
DEBUG_AI_TGSERVER_LOG_PROJECT_ID
DEBUG_AI_TGSERVER_KB_PROJECT_ID
DEBUG_AI_REPO_ALLOWLIST
DEBUG_AI_WORKSPACE_HOST_PATH
DEBUG_AI_OSV_DB_HOST_PATH
DEBUG_AI_TOOLS_HOST_PATH
GROQ_API_KEY
GEMINI_API_KEY
DEBUG_AI_GROQ_URL
DEBUG_AI_GEMINI_URL
```

External providers are bounded review services, not patch-application authorities.

## Container/security boundary

Production/server residency is Docker Compose only. Current boundary includes loopback application binding, `/workspace` repository mapping, no-new-privileges/capability reduction, controlled durable storage, sandbox/DAP isolation, bounded operational logging, and repository allowlist enforcement.

Do not install a persistent host Node/npm daemon as a shortcut around the container contract.

## Development and verification

Required Node.js runtime:

```text
24.20.0
```

Repository verification:

```bash
npm install
npm run verify
```

Current resumable source anchor `9dc8def...` passed:

```text
Public Readiness Audit #384 = SUCCESS
Verify #419                = SUCCESS
Dependency Review          = SUCCESS
Legacy Authority           = SUCCESS
Runtime Volume Gate #20    = SUCCESS
Core Verify #420           = SUCCESS
pre-server source audit    = READY
```

Documentation synchronization commits after this source anchor require their own exact-head CI before being used as the Server reflection revision.

## Current next-work order

Current-state owner: [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md).

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

## Safety boundaries

DebugAI must never become:

- a second state engine beside `RunAuthority`;
- an autonomous patch applier without explicit approval;
- a system that turns model confidence into evidence;
- a system that marks missing evidence as PASS;
- a system that accepts a noncanonical reviewer response as canonical success;
- a system that weakens claim/evidence validation merely to make a real model output pass;
- a system that replays mutation-capable effects automatically;
- a system that persists hidden chain-of-thought or credentials;
- a system that calls final-review PASS `COMPLETE` without the strict conjunction;
- a benchmark system that silently promotes candidates into production;
- a benchmark system that discards completed expensive real calls when interruption can be resumed safely;
- a reason to weaken repository, sandbox, revision, review, retention, or verification controls for speed.

DebugAI exists to make debugging faster and cheaper without sacrificing evidence, verification, approval, recovery, and security correctness.
