# DebugAI

DebugAI is a code-first, evidence-driven debugging runtime that operates as a specialized debugging sub-agent under a primary AI. It investigates failures, binds claims to evidence, creates patch candidates, preserves explicit human approval before mutation, verifies applied changes, survives interruption/restart, and refuses to call a run complete when required evidence is missing.

This repository is the canonical source authority. GitHub source/CI, shared AI Core state, live Contabo checkout/container state, and production state are separate facts and must be read back independently before any live claim.

## Current synchronization — 2026-10-06

The current feature work is PR #40 (`feat/tgserver-async-log-sink-20261003`), OPEN / DRAFT / UNMERGED. Implementation source `d1ee3ffd175fc530afe8f38e782859d1d63c8e61` closes the known post-apply deterministic-retest gap at the source/CI boundary.

At `d1ee3ffd...`, a failed deterministic retest no longer terminates immediately as `FAILED_RETEST`. The same run transitions through the existing `FAILED -> RESOLVING -> PATCH_READY -> WAITING_APPROVAL` states, registers fresh retest evidence, re-runs Diagnoser, requires a fresh External Hypothesis Review PASS, and creates a new Patch Candidate inside the previous selected-file scope. Automatic re-fix is bounded to two attempts; non-PASS review, missing required evidence/scope, or budget exhaustion fails closed to `ESCALATION_REQUIRED`. Patch application is never automatic: every new candidate still requires explicit approval bound to the exact candidate identity. In this development workflow the controlling parent/orchestrator is ChatGPT; Master is involved only when a separately defined Master-gated operation is crossed.

Qualification head `71bc123112e07859dce5b7ae24afaff7eec86a4f` adds an end-to-end same-run closure regression on top of implementation `d1ee3ffd...`. Canonical exact-head verification at `71bc123...` passed `464/464` tests with `FAIL=0` and `SKIP=0`, including four dedicated automatic re-fix regressions. The fourth regression proves: first approved candidate fails retest -> DebugAI creates a replacement candidate -> replacement waits for explicit approval -> approved replacement passes retest -> Local Review / External Final Review / Strict Completion -> `COMPLETE`. Development Probe run `37403103008` reported `source_ready=true` and `server_mutation_authorized=false`. Verify `37403103045`, Core Verify `37403103007`, Public Readiness `37403102991`, Runtime Volume Gate `37403103015`, Development Probe `37403103008`, and Targeted TGserver Logging `37403103011` all completed SUCCESS.

Core Verify executed the existing isolated Sandbox full-suite and produced `TESTS=464 / PASS=464 / FAIL=0 / SKIPPED=0` with `BACKEND=sidecar+landlock+seccomp`, `SIGNAL=EXACT_SOURCE_BOUND_CHILD_ONLY`, `SANDBOX_DOCKER_SOCKET=ABSENT`, real isolation PASS, strict socket deny PASS, DAP loopback-only PASS, and unchanged source-repository hash.

The currently reflected live DebugAI Server remains exact source `3997812067fe2a76e7fb6aea246ea8b34aa564c0`, previously verified running/healthy with `guarded_gitops=true`, request/status endpoints live, source parity PASS, and no DebugAI Docker socket. Source `d1ee3ffd...` is **not** live. Production reflection/recreate of a new exact SHA remains a separate Master approval boundary.

Shared Chat->GitHub->Server executor extraction is handled outside DebugAI. DebugAI retains its debugging, evidence, diagnosis, candidate, verification, automatic re-fix, review, and Strict Completion responsibilities.

## Read this first

Use the documents by responsibility, not as interchangeable status notes:

1. [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) — current verified repository/runtime boundary and next work.
2. [`docs/CURRENT_SOURCE_QUALIFICATION.md`](docs/CURRENT_SOURCE_QUALIFICATION.md) — latest source/CI qualification and isolated Sandbox closure.
3. [`docs/PROJECT_TREE.md`](docs/PROJECT_TREE.md) — responsibility/location map for repository work.
4. [`docs/DURABLE-CONTINUATION-DESIGN.md`](docs/DURABLE-CONTINUATION-DESIGN.md) — architecture/design authority and durable-continuation contract.
5. [`docs/PRE_SERVER_QUALIFICATION.md`](docs/PRE_SERVER_QUALIFICATION.md) — benchmark/source/live qualification order and pass/fail states.
6. [`docs/MCP_ADAPTER.md`](docs/MCP_ADAPTER.md) — MCP transport contract and tool boundary.
7. [`docs/CODEX_MCP_LIVE_HANDOFF.md`](docs/CODEX_MCP_LIVE_HANDOFF.md) — live parent-agent/MCP verification handoff.
8. [`DEBUGAI.md`](DEBUGAI.md) — CLI/MCP usage surface.
9. [`AGENTS.md`](AGENTS.md) — repository operating constraints for coding agents.

The design document preserves architecture decisions. `CURRENT_STATE.md` owns current implementation/runtime history; `CURRENT_SOURCE_QUALIFICATION.md` owns the latest source/CI qualification checkpoint. Do not rewrite an old design or measurement decision merely to make it look like it was always the current implementation.

## Current verified boundary

Live Server and current source are intentionally different states:

```text
LIVE_SERVER_SHA             = 3997812067fe2a76e7fb6aea246ea8b34aa564c0
IMPLEMENTATION_SHA           = d1ee3ffd175fc530afe8f38e782859d1d63c8e61
SOURCE_QUALIFICATION_HEAD    = 71bc123112e07859dce5b7ae24afaff7eec86a4f
CURRENT_SOURCE_DEPLOYED      = NO
SOURCE_QUALIFICATION_TESTS   = 464/464 PASS / FAIL=0 / SKIP=0
SOURCE_QUALIFICATION_CI      = 6/6 SUCCESS
AUTOMATIC_REFIX_SOURCE       = PASS
AUTOMATIC_REFIX_CLOSED_LOOP  = PASS_SOURCE_CI
STRICT_COMPLETION_LIVE       = NOT_VERIFIED_FOR_CURRENT_SOURCE
```

The live `399781...` reflection remains the verified Guarded GitOps infrastructure boundary. The newer `d1ee3...` source adds bounded automatic re-fix after a failed deterministic retest and is qualified only at source/CI/Sandbox until separately approved and reflected.

Historical live/source records below remain evidence for their recorded revisions and do not override this block.

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
Researcher -> Diagnoser -> External Hypothesis Review
        |
        | PASS only
        v
Patch Engineer -> candidate only
        |
        v
WAITING_APPROVAL
        |
        | explicit approval + exact candidate identity
        v
Patch apply -> deterministic retest + invariants
        |
        +---- PASS ----> Local Reviewer -> External Final Review -> Strict Completion
        |                                                        |
        |                                                        +--> COMPLETE / blocked / pending
        |
        +---- FAIL ----> fresh retest evidence
                         -> Diagnoser
                         -> fresh External Hypothesis Review
                         -> Patch Engineer
                         -> new candidate
                         -> WAITING_APPROVAL
                         -> at most 2 automatic re-fix attempts
                         -> otherwise ESCALATION_REQUIRED
```

The automatic part stops at candidate generation. It never grants approval to itself, never auto-applies a new candidate, and never bypasses evidence, revision, review, Sandbox, or Strict Completion gates.

The runtime is fail-closed at evidence, provider schema, repository scope/revision, patch identity, approval, durable execution, deterministic verification, bounded re-fix, review, and final completion boundaries.

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

Current source reuses the existing bounded read-only Tool Runtime for Patch Engineer candidate planning and for both Local Reviewer paths (post-apply review and read-only verification). This does not grant mutation authority: Patch Engineer remains candidate-only, Local Reviewer remains read-only, and deterministic `diff.plan` / `test.plan` / `rollback.plan` plus Review Packet diff/test-result data remain their existing non-runtime authorities rather than being duplicated as new tools. This source change is not a claim that the approved live runtime already contains it; live reflection remains a separate exact-SHA approval boundary.

## Current context, token, and prompt-cache policy

The current source supersedes the historical fixed role output ceilings `600/600/600/800/2048/1024` as active policy. Those low values remain historical measurement evidence only.

Current source uses `debugai.model-profile/v4` and separates three different concepts that must not be collapsed:

1. model context capacity;
2. model generation/output ceiling;
3. actual AI Core runtime context capacity.

Current model-profile source ceilings are:

```text
Qwen2.5-Coder 7B    declared generation ceiling = 8192
Qwen3 8B            native-context ceiling       = 32768
Granite 4.2 8B      native-context ceiling       = 131072
Ministral 3 8B      native-context ceiling       = 262144
```

A real request is then clamped again to the independently qualified AI Core runtime context before it is sent. The compatibility `1000` token constant is a runtime input reserve for this clamp; it is not a universal claim that every model has `native context - 1000` as its generation maximum.

`max_tokens` is a ceiling, not a target consumption amount. Historical prompt/prefill latency is not used to justify starving generation output. `finish_reason=length` is rejected as `AI_CORE_OUTPUT_TRUNCATED`.

### 85% context-pressure compaction

Context efficiency is achieved by reducing redundant working context, not by deleting evidence or forcing tiny role outputs.

Current Tool Loop behavior:

- the Active Evidence Window remains bounded by the existing item/character safety limits;
- below 85% measured prompt pressure, more detailed recent tool observations may remain inside that bounded window;
- at or above 85%, the next working context keeps only the five most recent detailed tool results;
- older raw tool results remain in durable runtime state;
- older entries are represented by compact evidence pointers rather than replaying their raw content;
- full older content is rehydrated only through admitted `evidence.read`;
- compact historical pointers are not treated as supporting evidence text by themselves.

Source `c9aa6f28...` retains the runtime regression proving that measured 85% prompt pressure changes the next AI call to the five-item detailed window while older evidence remains referenced.

### Prompt-cache and speed operation

Prompt-cache reuse is explicit source behavior, not an assumed provider default.

- AI Core sends `cache_prompt=true` explicitly;
- current llama.cpp-style `timings.cache_n` and `timings.prompt_n` are consumed as observed cached/processed prompt token counts, while compatible existing telemetry forms remain supported;
- prompt-evaluation time and decode time stay separate in telemetry;
- Tool Loop keeps its System/Skill/role prefix stable across rounds;
- final-round control is kept out of the canonical Tool Loop user/evidence payload and is appended only by the AI Core transport on the final tool-budget request;
- role telemetry reports measured cache-hit ratio, whether cache telemetry was complete, observed prefix hashes, and prefix stability without inventing values when the provider does not report them.

Cache is an acceleration layer only. Cached execution never becomes evidence authority and never bypasses revision binding, evidence validation, output-schema validation, truncation rejection, deterministic verification, Local Reviewer, External Final Review, or Strict Completion. Faster is useful only when the result remains equally verifiable.

The last measured live AI Core context remains `8192`; `--cache-ram` was last measured at 4096. Prompt caching does not enlarge `n_ctx`. Any live context increase above 8192 must be separately measured for RAM pressure, cache behavior, prompt-eval latency, decode speed, and end-to-end role latency before a separate Master-approved Server change.

Researcher A→E durable Work Unit reuse is implemented. A general Block Core execution path across every workflow is not connected and remains a separate unfinished capability.

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

## Historical Local Reviewer canonical closure

The Local Reviewer qualification history has distinct causes:

1. an early real run timed out while AI Core was under severe memory reclaim pressure;
2. after the authorized resource correction, one run returned `ROLE_OUTPUT_JSON_INVALID`;
3. a RAW recapture returned complete but noncanonical `review_state/material_claims` output;
4. the top-level contract was tightened;
5. three real runs then exposed `CLAIM_TYPE_INVALID` because the prompt did not explicitly require canonical `claims[].type`;
6. the prompt contract was repaired without weakening validation;
7. the fixed source was reflected to Server revision `4c7e727...` and measured three consecutive times.

Current historical real result on that reflected path:

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

Therefore the Local Reviewer canonical defect is closed for that tested serial path. This is not evidence that every workflow/concurrency/integration path or the current source is live-qualified.

## AI Core runtime boundary

DebugAI uses the shared AI Core rather than owning backend model processes.

A real Local Reviewer timeout investigation found that the previous AI Core memory ceilings caused active reclaim/throttling even though the host still had available RAM. Master authorized the resource correction.

Last measured AI Core resource authority:

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

Historical observed cache/timing measurements on fa690041 are recorded in `docs/CURRENT_STATE.md`. They do not prove broader semantic-quality improvement or a larger runtime context.

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

### Deployed resumable runner and historical low-cap evidence

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

Historical Diagnoser diagnostics demonstrated output exhaustion: 600/800/1024/1536-token paths could terminate with `finish_reason=length`, while selected 1024/1536/2048 one-variable retries completed some individual cases. Those measurements remain historical evidence explaining the source correction. They are not current production limits, are not combined across budgets into a winner, and do not authorize promotion.

The current source keeps `AI_CORE_OUTPUT_TRUNCATED` fail-closed and removes the fixed low-cap policy itself in favor of model-profile ceilings plus the qualified runtime-context clamp.

Historical checkpoint/candidate records remain source-fingerprint-bound. They must not be edited or rebound to the current source.

Model A/B source contract reproduction also proved that a visible partial response with `finish_reason=length` must not be accepted as success. Real Thinking/Sampling/Token-cap A/B for the current source remains NOT_EXECUTED.

Live MCP stdio on approved b30649a passed initialize, the exact ordered nine-tool list, and real health delegation. No approval/apply shortcut was exposed. Full analyze/start/resume/wait/status/inspect continuation remains NOT_VERIFIED for the current source.

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

Patch generation and patch application remain separate operations.

Patch Engineer produces a candidate only. Application requires explicit controlling-parent/orchestrator approval bound to the exact candidate ID/hash. This is a technical decision boundary, not automatically a Master/user decision. After application, deterministic retest and invariants run before review.

If deterministic retest fails, current source may automatically perform at most two **candidate-generation** re-fix attempts using fresh failed-retest evidence. Each attempt:

- stays inside the prior candidate's selected-file scope;
- re-runs Diagnoser from fresh retest evidence;
- requires a fresh External Hypothesis Review PASS;
- permits only bounded replace/write operations inside that scope;
- creates a new candidate without applying it;
- returns to `WAITING_APPROVAL`.

Non-PASS external review, missing evidence/scope, unsupported operation/scope drift, or exhausted attempt budget fails closed to `ESCALATION_REQUIRED`.

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
| POST | `/v1/server-command/request` | queue an existing bounded Server Command read |
| POST | `/v1/server-command/status` | existing Server Command status by id |
| POST | `/v1/gitops/request` | existing guarded GitOps request |
| POST | `/v1/gitops/status` | existing guarded GitOps status |
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
server-command <request|status> --input-json <service-contract-json>
gitops <request|status> --input-json <service-contract-json>
```

MCP exposes thirteen guarded tools (the original nine plus four control tools):

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
debugai_server_read
debugai_server_status
debugai_gitops_request
debugai_gitops_status
```

Continuation is explicit:

```text
debugai_start -> exact run_id -> debugai_status -> debugai_resume when applicable -> debugai_wait -> debugai_inspect
```

The four control tools reuse the existing Server Command and GitOps services through CLI/HTTP. Their transport extension is source-only; runtime reflection is NOT_RUN. See [`DEBUGAI.md`](DEBUGAI.md) and [`docs/MCP_ADAPTER.md`](docs/MCP_ADAPTER.md).

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

The bounded Host Server Command runner validates requests with real Bash/jq.
Its lifecycle regression is `node --test ops/tests/server-command-host-execution.test.cjs`
on a test toolchain with jq; it executes the runner against temporary queues and
checks successful exact readback and fail-closed rejection by the original request ID.
Production reflection remains separately approved and verified.
The existing user path/oneshot unit dispatches Server Command and guarded GitOps
queues to their existing Bash runners. Updating active units requires the same
separate runtime approval as reflection; GitOps deploy still requires its
single-use exact-SHA Host approval receipt. The unit refreshes the already-authorized
docker group with `sg docker` for both runners, so a stale user-manager group list
does not deny Docker socket access. Its 40-minute timeout covers one bounded deploy
build/recreate/health cycle without restarting unrelated user services.

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

Implementation `d1ee3ffd175fc530afe8f38e782859d1d63c8e61` plus qualification head `71bc123112e07859dce5b7ae24afaff7eec86a4f` passed canonical exact-head verification and the existing isolated Full-suite Sandbox with 464/464 PASS and zero skip. Exact run/evidence identifiers are recorded in `docs/CURRENT_SOURCE_QUALIFICATION.md`.

Documentation-only commits after that anchor require their own exact-head CI before the resulting documentation head may be considered a Server reflection candidate.

## Current next-work order

Current-state history owner: [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md). Latest source qualification owner: [`docs/CURRENT_SOURCE_QUALIFICATION.md`](docs/CURRENT_SOURCE_QUALIFICATION.md).

```text
1. synchronize this automatic re-fix source change through Current docs, PR #40, Issue #41 and exact final-head CI
2. keep live Server at 3997812067fe2a76e7fb6aea246ea8b34aa564c0 until Master separately approves one exact newer SHA
3. after an approved reflection, run a real failed-retest dogfood E2E and prove: fresh evidence -> re-diagnosis -> new candidate -> controlling-orchestrator approval wait -> approved apply -> retest
4. continue remaining real current-runtime integration, MCP durable continuation, semantic-quality/benchmark qualification and Strict Completion from measured evidence
5. keep shared Deploy Bridge extraction outside DebugAI product logic
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
- a context compaction system that deletes durable evidence instead of keeping rehydratable references;
- a cache system that treats cached output as evidence or correctness authority;
- a reason to weaken repository, sandbox, revision, review, retention, or verification controls for speed.

DebugAI exists to make debugging faster and cheaper without sacrificing evidence, verification, approval, recovery, model capability, context reliability, and security correctness.
