# DebugAI

DebugAI is a code-first, evidence-driven debugging runtime that operates as a specialized debugging sub-agent under a primary AI. It investigates failures, binds claims to evidence, creates patch candidates, preserves explicit human approval before mutation, verifies applied changes, survives interruption/restart, and refuses to call a run complete when required evidence is missing.

This repository is the canonical source authority. GitHub source/CI, shared AI Core state, and the live Contabo checkout/container are separate facts and must be read back independently before any live claim.

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

Current qualified implementation anchor before this documentation synchronization:

```text
repository                       = seigo-gace/debug-ai
branch                           = feat/pre-server-benchmark-gates-20261001
implementation anchor            = 0ad40ea939866c9ae59086c1030aadd3f76bdb4a
PR                               = #34 / OPEN / DRAFT / UNMERGED
Public Readiness Audit           = #380 SUCCESS
Verify                           = #415 SUCCESS
repository tests                 = 381/381 PASS
Dependency Review                = SUCCESS
Legacy Authority                 = SUCCESS
Runtime Volume Gate              = #16 SUCCESS
Core Verify                      = #416 SUCCESS
pre-server source qualification  = READY
MCP source/unit/stdio            = PASS / exact 9 tools
runtime-image qualification      = PASS
main merge                       = NOT EXECUTED
```

Current live DebugAI Server boundary before reflecting the latest claim-type contract repair:

```text
checkout path                    = /home/admin1/projects/debug-ai
checkout mode                    = detached HEAD
checkout HEAD                    = ebe48131b236d8ca44057c813236fd0e99925214
.debugai-input/                  = preserved / untracked
runtime-init                     = Exited (0)
sandbox-init                     = Exited (0)
sandbox-runner                   = Up
running debug-ai container       = healthy
container entrypoint             = node server/main.js
container workdir                = /app
loopback /health                 = PASS
tracked worktree                 = CLEAN
source parity                    = PASS for deployed ebe48131 source
pre-server qualification         = READY for deployed source
live current-source state        = RUNTIME_SOURCE_BEHIND_OR_UNKNOWN
Search Gate shadow               = NO_SHADOW_RECORDS / NOT_EVALUABLE
Search skip activation           = NO
```

The `ebe48131...` Server reflection itself passed: `.debugai-input` was preserved, persistent volumes were not deleted, runtime/sandbox initialization completed successfully, DebugAI became healthy, Host↔Container source parity passed for the changed control/Workflow files, and the tracked worktree remained clean.

The running runtime is healthy for its deployed revision. It is not evidence that current source `0ad40ea...` is deployed.

Master explicitly authorized the Current DebugAI Server source-reflection/build/recreate phase after README/document synchronization. That authorization does not merge PR #34 to main, delete `.debugai-input/` or persistent runtime volumes, authorize Search Gate activation, change production model profiles, change secrets/providers, download new models, or waive post-deploy verification.

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

This explicit claim-item contract was added after the real Local Reviewer path on deployed `ebe48131...` failed three consecutive times with `CLAIM_TYPE_INVALID`. The validator already required canonical `type`; the missing piece was that the prompt did not explicitly tell the model the required field name and allowed values. The repair tightens the invocation contract rather than weakening validation.

## Current Local Reviewer real state

The Local Reviewer qualification history has distinct causes and must not be collapsed into one generic failure.

1. An early real run timed out while AI Core was under severe memory reclaim pressure.
2. After the authorized AI Core resource correction, one run returned `ROLE_OUTPUT_JSON_INVALID`.
3. A RAW recapture then returned complete JSON but used noncanonical top-level `review_state/material_claims` fields.
4. The top-level contract was repaired, documented, and reflected to Server at `ebe48131...`.
5. Three consecutive real benchmarks on `ebe48131...` then failed with `ROLE_CLAIM_EVIDENCE_INVALID` because model claims omitted/invalidly represented canonical claim `type`.

Measured three-run result on the currently deployed runtime:

```text
run 1 = FAIL / CLAIM_TYPE_INVALID on claims 0..3
run 2 = FAIL / CLAIM_TYPE_INVALID on claims 0..2
run 3 = FAIL / CLAIM_TYPE_INVALID on claims 0..2
AI Core HIGH delta     = 0 on every run
AI Core MAX delta      = 0 on every run
AI Core OOM delta      = 0 on every run
AI Core OOM_KILL delta = 0 on every run
```

Therefore the current real Local Reviewer gate is `FAIL`, not `PASS` and not `NOT_EXECUTED`. Source `0ad40ea...` contains the claim-type prompt repair but has not yet been reflected to the live Server.

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

Post-change short inference measured approximately Granite 7.31 tok/s, Qwen3 5.61 tok/s, Ministral 7.45 tok/s, and Coder 8.05 tok/s. A 128-token Ministral retest measured about 6.12 tok/s with zero new parent High/Max/OOM/OOM-kill and zero Ministral max events. The DebugAI role timeout was therefore not extended as a workaround.

The three latest Local Reviewer failures also produced zero new AI Core High/Max/OOM/OOM-kill events, separating the current claim-type defect from the closed resource incident.

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

A source audit never converts an unexecuted or failed real benchmark into PASS.

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

The Local Reviewer real gate additionally requires canonical `verdict / decision / claims`, valid canonical `claims[].type`, and valid evidence binding. A parseable substitute schema is not a PASS.

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

Qualified claim-type repair source anchor `0ad40ea...` passed:

```text
Public Readiness Audit #380 = SUCCESS
Verify #415                = SUCCESS
Tests                      = 381/381 PASS
Dependency Review          = SUCCESS
Legacy Authority           = SUCCESS
Runtime Volume Gate #16    = SUCCESS
Core Verify #416           = SUCCESS
pre-server source audit    = READY
```

Core Verify includes real Docker image build/container health, Landlock+seccomp, managed Node/Python DAP, main-to-sidecar queue round trip, and Compose boundary checks.

Documentation synchronization commits after this source anchor require their own exact-head CI before being used as the Server reflection revision.

## Current next-work order

The authoritative current order is maintained in [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md). The next phase is:

```text
1. complete README/current-state/qualification documentation synchronization for 0ad40ea source + ebe48131 measured runtime
2. require exact documentation-following HEAD CI PASS
3. reflect that exact confirmed GitHub revision to /home/admin1/projects/debug-ai while preserving .debugai-input and persistent volumes
4. rebuild/recreate only required DebugAI Compose services
5. prove runtime-init/sandbox-init, exact source/runtime parity, tracked cleanliness, and /health
6. rerun pre-server/live-runtime readback gates where executable
7. execute Local Reviewer real benchmark three consecutive times
8. require canonical verdict/decision/claims, valid claims[].type, valid evidence binding, and zero new AI Core High/Max/OOM events
9. only after stable Local Reviewer PASS, execute six-role Skill ON/OFF measurements
10. execute one-variable Model A/B in the documented order
11. prove real AI Core/TGserver/Evidence Search/allowed-repository integration as applicable
12. prove MCP discovery/health/durable continuation
13. measure Search Gate shadow without activating skipping
14. execute fresh self-debug and final production-equivalent closed-loop E2E
```

Server reflection approval is not permission to merge PR #34, activate Search Gate skipping, change production model profiles, alter Secrets/providers, download models, delete local runtime state, or bypass any runtime gate.

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
- a reason to weaken repository, sandbox, revision, review, retention, or verification controls for speed.

DebugAI exists to make debugging faster and cheaper without sacrificing evidence, verification, approval, recovery, and security correctness.
