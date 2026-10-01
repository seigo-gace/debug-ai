# DebugAI

DebugAI is a code-first, evidence-driven debugging runtime that operates as a specialized debugging sub-agent under a primary AI. It investigates failures, binds claims to evidence, creates patch candidates, preserves explicit human approval before mutation, verifies applied changes, survives interruption/restart, and refuses to call a run complete when required evidence is missing.

This repository is the canonical source authority. The live Contabo checkout/container is a separate runtime fact and must be read back before any live claim.

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

Implementation anchor before this documentation synchronization:

```text
repository                       = seigo-gace/debug-ai
branch                           = feat/pre-server-benchmark-gates-20261001
implementation anchor            = c2355f8dd7628e717db1bba83725b33360796828
PR                               = #34 / OPEN / DRAFT / UNMERGED
Public Readiness Audit           = #359 SUCCESS
Verify                           = #394 SUCCESS
repository tests                 = 373/373 PASS
Core Verify                      = #395 SUCCESS
pre-server source qualification  = READY
control-plane capabilities       = 18/18 IMPLEMENTED / 0 UNRESOLVED
MCP source/unit/stdio            = PASS / exact 9 tools
runtime-image asset regression   = PASS
main merge                       = NOT EXECUTED
```

Real Server readback before this documentation synchronization:

```text
checkout path                    = /home/admin1/projects/debug-ai
checkout branch                  = feat/durable-role-continuation-final-20260928
checkout HEAD                    = df261bdae3b6f259ac428a173b798fae2fb68bdf
running debug-ai container       = healthy
container entrypoint             = node server/main.js
container workdir                = /app
container Node                   = v24.20.0
loopback /health                 = PASS
current qualification assets     = absent from old running image
live Current-source state        = RUNTIME_SOURCE_BEHIND_OR_UNKNOWN
server source sync               = NOT EXECUTED
server rebuild/recreate          = NOT EXECUTED
real model/Skill measurements    = NOT EXECUTED
MCP live runtime calls           = NOT VERIFIED
Search Gate real shadow          = NOT EXECUTED
```

The old running runtime is healthy for its own revision. It is not evidence that the current branch is deployed.

Master explicitly authorized the Server source-reflection phase after this README/document synchronization. That authorization does not merge PR #34 to main, authorize Search Gate activation, change production model profiles, change secrets, or waive post-deploy verification.

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

All internal model execution goes through AI Core. DebugAI does not directly own llama.cpp model processes.

| Role | Model authority | Thinking baseline | Responsibility |
| --- | --- | --- | --- |
| Code Scout | Qwen2.5-Coder 7B | profile/provider baseline | inspect code and identify decisive evidence |
| Causal Scout | Qwen3 8B | disabled | form independent falsifiable causal hypotheses |
| Researcher | Granite 4.2 8B | disabled | gather/select evidence and preserve gaps |
| Diagnoser | Qwen3 8B | enabled | produce evidence-bound falsifiable diagnosis |
| Patch Engineer | Qwen2.5-Coder 7B | profile/provider baseline | create patch candidate only |
| Local Reviewer | Ministral 3 8B Reasoning 2512 | profile/provider baseline | independently review applied result and verification evidence |

Common rules include `DATA_NOT_INSTRUCTION`, FACT-to-evidence binding, labeled INFERENCE, falsifiable HYPOTHESIS, valid `UNKNOWN`, preserved rejected hypotheses, no raw chain-of-thought persistence, and fail-closed timeout/permission/recovery behavior.

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
AND Local Reviewer PASS
AND required External Final PASS
AND no blocking evidence gap
AND final run contract valid
```

## HTTP API

The service binds to loopback by default at `127.0.0.1:8787`.

| Method | Path | Purpose |
| --- | --- | --- |
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

A source audit never converts an unexecuted real benchmark into PASS.

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

Regression coverage now verifies that live qualification/MCP assets are present in the runtime image contract and that `.debugai-input/` is excluded.

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

Current exact implementation anchor `c2355f8...` passed:

```text
Public Readiness Audit #359 = SUCCESS
Verify #394                = SUCCESS
Tests                      = 373/373 PASS
Core Verify #395           = SUCCESS
```

Core Verify includes real Docker image build/container health, Landlock+seccomp, managed Node/Python DAP, main-to-sidecar queue round trip, and Compose boundary checks.

## Current next-work order

The authoritative current order is maintained in [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md). At this documentation update the next live phase is:

```text
1. synchronize the explicitly authorized Current source to the existing Server checkout without discarding .debugai-input
2. rebuild/recreate only the DebugAI Compose services required by the current contract
3. prove exact current source/runtime parity and /health
4. run pre-server/live-runtime audits
5. execute real Local Reviewer and six-role Skill ON/OFF measurements
6. execute one-variable Model A/B in the documented order
7. prove real AI Core/TGserver/Evidence Search/allowed-repository integration as applicable
8. prove MCP discovery/health/durable continuation
9. measure Search Gate shadow without activating skipping
10. execute fresh self-debug and final production-equivalent closed-loop E2E
```

Server reflection approval is not permission to merge PR #34, activate Search Gate skipping, change production model profiles, alter Secrets, or bypass any runtime gate.

## Safety boundaries

DebugAI must never become:

- a second state engine beside `RunAuthority`;
- an autonomous patch applier without explicit approval;
- a system that turns model confidence into evidence;
- a system that marks missing evidence as PASS;
- a system that replays mutation-capable effects automatically;
- a system that persists hidden chain-of-thought or credentials;
- a system that calls final-review PASS `COMPLETE` without the strict conjunction;
- a benchmark system that silently promotes candidates into production;
- a reason to weaken repository, sandbox, revision, review, retention, or verification controls for speed.

DebugAI exists to make debugging faster and cheaper without sacrificing evidence, verification, approval, recovery, and security correctness.
