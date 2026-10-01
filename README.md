# DebugAI

DebugAI is a code-first, evidence-driven debugging runtime for G-ACE development workflows. It is designed to work as a specialized debugging sub-agent under a user's primary AI: it gathers and binds evidence, runs role-specialized investigation, creates patch candidates, preserves explicit human approval before mutation, retests deterministically, reviews the applied result, survives interruption/restart, and refuses to mark a run complete when required evidence is missing.

> **Source authority:** this GitHub repository is the canonical source. The currently deployed Contabo checkout is a separate runtime fact and must never be assumed to match the active GitHub branch without explicit readback.

> **Completion rule:** a module existing in source, a fixture passing, a CI run succeeding, or an external reviewer returning PASS is not enough to claim the DebugAI project complete. Project completion still requires the intended real runtime closed loop with current evidence and the required gates.

## Required first read: design authority

**Before development, debugging, verification, refactoring, continuation, or implementation planning, read the design authority below first. Do not start from README status alone.**

- **Design authority:** [`docs/DURABLE-CONTINUATION-DESIGN.md`](docs/DURABLE-CONTINUATION-DESIGN.md)
- **MCP integration contract:** [`docs/MCP_ADAPTER.md`](docs/MCP_ADAPTER.md)
- **Pre-server qualification:** [`docs/PRE_SERVER_QUALIFICATION.md`](docs/PRE_SERVER_QUALIFICATION.md)
- **VS Codex live MCP handoff:** [`docs/CODEX_MCP_LIVE_HANDOFF.md`](docs/CODEX_MCP_LIVE_HANDOFF.md)

Use the documents and history with these distinct responsibilities:

```text
DESIGN
= the design baseline, architecture, intended responsibilities, constraints, and original decisions
= do not silently overwrite it merely to match later implementation

COMMITS
= the chronological work report and implementation/change history
= use commit history and diffs to determine what actually changed from the design and when

DESIGN DELTA / CHANGE RATIONALE
= when implementation intentionally differs from the design, preserve what differed, why it changed,
  what evidence caused the change, and which commit implemented it
= do not erase the old design baseline by rewriting it as though the later implementation had always been the design

README
= the current completed/verified operating state and the current entry point for users, developers, and AI agents
= update completed areas as development closes them so new work does not get pulled back to obsolete pending states
```

Required repository-reading loop:

```text
README current state
 -> open and read the linked design authority
 -> inspect relevant commits/diffs for implementation history
 -> inspect recorded design delta/change rationale when implementation differs
 -> confirm current source/tests/runtime evidence
 -> continue work from the actual current boundary
```

If design and implementation differ, do not automatically treat either side as disposable. Preserve the design baseline, identify the delta and rationale from evidence/history, and only revise the design itself when an explicit architecture/design decision actually changes the design authority.

## Active design authority

The system design, durable-continuation architecture, AI-side optimization rules, Strict Completion contract, storage/retention policy, and design baseline are defined in:

- [`docs/DURABLE-CONTINUATION-DESIGN.md`](docs/DURABLE-CONTINUATION-DESIGN.md)

The MCP adapter is a compatible parent-agent transport/integration layer and does not replace or rewrite that baseline. Its integration boundary is defined in:

- [`docs/MCP_ADAPTER.md`](docs/MCP_ADAPTER.md)

Current repository authority at this README update:

```text
repository                       = seigo-gace/debug-ai
branch                           = feat/pre-server-benchmark-gates-20261001
base branch                      = feat/search-gate-shadow-audit-cli-20261001
base SHA                         = cfbe2908bb6190bc5f5c894779c4d0f08f51b80e
verified implementation HEAD     = a7006347952808fe4ba017c51120fad436b8a6bc
PR                               = #34 / OPEN / DRAFT / UNMERGED
Public Readiness Audit           = SUCCESS (#352)
Verify                           = SUCCESS (#387 / 370 of 370 PASS)
Core Verify                      = SUCCESS (#388)
control-plane capabilities       = 18/18 IMPLEMENTED / 0 UNRESOLVED
pre-server source qualification  = READY / CI-EXECUTED / REAL MEASUREMENTS NOT EXECUTED
six-role Skill A/B source        = READY / REAL MEASUREMENT NOT EXECUTED
Model A/B source axes            = thinking / temperature / top_p / top_k / max_tokens
MCP source/unit/stdio protocol   = PASS / 9 guarded tools
MCP durable continuation surface = PASS
live-runtime readback source     = V3 EXACT SOURCE PARITY + SOURCE/CI VERIFIED
real Server readback             = NOT_EXECUTED / DELEGATED TO VS CODEX
real model/Skill measurements    = NOT_EXECUTED / DELEGATED TO VS CODEX LIVE PHASE
real MCP live-runtime calls      = NOT_EXECUTED / DELEGATED TO VS CODEX
real Search Gate measurement     = NOT_EXECUTED
false-skip zero proof            = NOT_PROVEN
Search Gate skip activation      = NOT_EXECUTED
main merge                       = NOT_EXECUTED
server deploy                    = NOT_EXECUTED
server restart                   = NOT_EXECUTED
production change                = NONE
```

These source/CI results do **not** prove that the live Contabo checkout is on this revision. The live repository/container/revision must be read back before any real-runtime claim, real-model benchmark, MCP live claim, or Search Gate measurement. Master has assigned that live-server check to VS Codex. If the live checkout/container is behind, preserve that fact as `RUNTIME_SOURCE_BEHIND_OR_UNKNOWN`; do not silently sync, deploy, or restart it.

Current source/protocol/pre-server verification at exact implementation SHA `a7006347952808fe4ba017c51120fad436b8a6bc`:

```text
Verify                          = SUCCESS (#387)
Core Verify                     = SUCCESS (#388)
Public Readiness Audit          = SUCCESS (#352)
repository tests                = 370/370 PASS
pre-server qualification audit  = source_ready=true
six-role benchmark suite        = SOURCE READY
Model A/B five-axis harness     = SOURCE READY
MCP stdio handshake             = PASS
MCP tools/list                  = PASS / 9 expected tools
MCP health call                 = PASS
approve/apply MCP tool          = ABSENT
real benchmark/model results    = NOT_EXECUTED_BY_SOURCE_AUDIT
```

Historical MCP implementation SHA `078203e61073be99a48444ba0c3467a7143102f4` also passed its then-current 286/286 suite and real stdio regression. Historical results remain evidence for their exact SHA but are not reused as current-head proof.

Current MCP state separation:

```text
MCP_SOURCE=PASS
MCP_UNIT_CONTRACT=PASS
MCP_STDIO_PROTOCOL=PASS
MCP_TOOLS_9_OF_9=PASS
MCP_DURABLE_CONTINUATION_SURFACE=PASS
MCP_CI=PASS
MCP_LIVE_DEBUGAI_RUNTIME=NOT_VERIFIED
VS_CODEX_MCP_REGISTRATION=NOT_VERIFIED
WORKSPACE_REGISTRATION=NOT_EXECUTED
```

---

## What DebugAI does

The guarded debugging flow is:

```text
Failure / request / local evidence
        |
        v
Deterministic verification + optional DAP hint
        |
        v
Code Scout + Causal Scout
        |
        +----> TGserver knowledge retrieval when required
        |
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
        | explicit approve + candidate identity binding
        v
Apply patch
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
        |
        +----> blocked / failed / pending / unknown
```

The runtime is intentionally fail-closed at evidence, provider schema, repository, approval, patch identity, revision, deterministic verification, review, durable execution, and final-completion boundaries.

---

## Six internal AI roles

All internal AI execution goes through AI Core. DebugAI does not directly manage llama.cpp ports or model processes.

| Role | Current model authority | Thinking baseline | Responsibility |
| --- | --- | --- | --- |
| Code Scout | Qwen2.5-Coder 7B | profile/provider baseline | inspect code and identify decisive evidence to gather |
| Causal Scout | Qwen3 8B | disabled | form independent falsifiable causal hypotheses |
| Researcher | Granite 4.2 8B | disabled | gather/select evidence and preserve evidence gaps |
| Diagnoser | Qwen3 8B | enabled | produce evidence-bound falsifiable diagnosis |
| Patch Engineer | Qwen2.5-Coder 7B | profile/provider baseline | create patch candidate only |
| Local Reviewer | Ministral 3 8B Reasoning 2512 | profile/provider baseline | review the applied result from fresh review context |

Common role rules include `DATA_NOT_INSTRUCTION`, FACT-to-evidence binding, labeled INFERENCE, falsifiable HYPOTHESIS, valid `UNKNOWN`, preserved rejected hypotheses, no raw chain-of-thought persistence, and fail-closed permission/timeout/recovery behavior.

Roles are not interchangeable. Purpose, entry/stop conditions, context, skill procedure, tools, network/write scope, token/timeout/round budgets, and failure policy remain role-specific. Model thinking/sampling/profile/tool-protocol settings remain model/profile concerns rather than being flattened into one universal prompt.

---

## Current AI-side optimization

Optimization priority is:

```text
1. unnecessary role calls
2. unnecessary search/provider calls
3. duplicated prompt content
4. repeated Tool Observation payload
5. unnecessary skills
6. unnecessary tool rounds
7. completion-token volume
8. thinking mode
9. sampling
10. model parallelism
```

The AI Core global serial queue is currently intentional. DebugAI does not enable parallel model execution merely because it may look faster in theory; server RAM/CPU/queue behavior must be measured first.

### AI Core telemetry — implemented

`server/adapters/ai-core.js` records measured values such as queue wait, preparation, upstream wall time, parse/validation time, role wall time, request/response bytes, attempts, provider token counts when supplied, and finish reason.

Unavailable provider values remain `null`. Estimated values are not reported as measured values. Timeout/HTTP-error paths retain telemetry collected before the failure.

### Role Tool Loop telemetry — implemented

`server/control/tool-loop.js` records role-level LLM/tool execution telemetry including executed versus reused tool work.

### Pre-server benchmark harness — source ready

The repository now contains deterministic live-measurement entry points without pretending that source readiness equals a real result:

```text
npm run benchmark:local-reviewer
npm run benchmark:skill-effect-all
npm run benchmark:model-ab -- --role <role> --axis <axis> --candidate <value|official> --repeats <1..5>
npm run audit:pre-server-qualification
```

The six-role Skill suite accepts Skill OFF wins and ties. The Model A/B harness changes exactly one axis, counterbalances baseline/candidate execution order, derives the score ceiling from the role scorer, and fixes `promotion_authorized=false`.

Current Model A/B source axes are:

```text
thinking
temperature
top_p
top_k
max_tokens
```

Benchmark `top_p` / `top_k` are sent only for an explicitly selected candidate request. Production role defaults are unchanged by the harness. Official candidate gaps fail closed rather than inventing a number. The harness does not claim a complete sweep of every sampler exposed by llama.cpp.

---

## Evidence architecture

Model confidence is not evidence.

DebugAI separates and validates evidence from:

- local deterministic runtime checks;
- read-only tool execution;
- DAP/runtime hints;
- TGserver knowledge retrieval;
- Astera Evidence Search;
- durable restored effects/results.

DAP material remains `HINT_ONLY` until it is converted into allowed registered evidence. Tool errors are not supporting evidence. Missing authoritative evidence becomes an explicit evidence gap rather than fabricated support.

### Evidence Search

Astera Evidence Search is accessed through the internal API and configured service authentication. The adapter enforces the expected schema, free-only behavior, `ai_used === false`, `payment_executed === false`, and the required final-valid state.

A non-final response such as `REJECTED_INITIAL_QUALITY` remains an evidence gap.

### TGserver

TGserver is consumed via HTTP APIs rather than direct Telegram, Redis, or Meilisearch access. Runtime logging/archival and knowledge-base retrieval/promotion remain separate responsibilities.

### Evidence reads and source verification

The read-only evidence/control-plane boundary now includes:

- `evidence.read` — bounded projection of runtime-authentic evidence;
- `runtime.trace.read` / `state.read` — current-run-bound runtime observation;
- `history.read` — bounded rejected-hypothesis history from the canonical `history.jsonl` authority;
- `invariant.read` — immutable Master source-span authority plus separately reported runtime-verified invariants;
- `source.verify` — fail-closed source identity/version/quote/claim-support verification over already admitted evidence.

`source.verify` deliberately does **not** relabel integrity as semantic support. `SUPPORTED` is limited to exact normalized direct text from an official evidence excerpt or `source.read` content. Internal-KB claim metadata and ordinary non-matches remain `UNKNOWN`; explicit structured official contradiction can yield `UNSUPPORTED`. Missing or ambiguous version applicability remains an evidence gap.

---

## Evidence Projection + Active Evidence Window

This is **implemented and connected to the Tool Loop**.

Original observations and durable evidence are preserved. Only the prompt view is bounded to prevent historical Tool Observations from being re-sent in full on every LLM call.

Current limits:

```text
max chars per projected evidence = 2400
max active evidence items        = 12
max projected evidence chars     = 12000
```

Tool errors remain bounded `DATA_ONLY` summaries and do not become evidence.

This is prompt compression, not evidence deletion.

---

## Durable continuation and replay-safe recovery

Durable continuation covers both runtime recovery and AI-side continuation.

### Runtime layer

The runtime preserves and validates:

```text
run_id
role_execution_id
attempt
generation
execution_epoch
workflow cursor
checkpoint/result/effect references
retry / timeout / cancellation / no-progress state
```

It uses one authoritative writer/commit path with durable file I/O, native writer lock, generation monotonicity, epoch fencing, integrity validation, and fail-closed stale-writer rejection.

### AI-side layer

Roles can reuse compatible committed deterministic/read-only effects, preserve explicit work-unit progress, continue from the next unfinished work unit, and commit durable RoleResults without persisting hidden reasoning.

Researcher uses resumable A/B/C/D/E work units integrated with the existing Tool Loop and ProgressController.

### Required restart behavior

```text
A commits
B commits
C starts
C is interrupted
process restarts
same run_id
same role_execution_id
new continuation attempt
A reused, not rerun
B reused, not rerun
C continues
RoleResult committed
Diagnoser consumes restored Researcher result
```

Real SIGKILL restart regression is covered by the current regression suite.

A durable regression discovered during this work was caused by semantic-shadow metadata being attached as a non-enumerable own property to authoritative role JSON. Durable canonical JSON correctly rejected it. The fix moved semantic-shadow state outside the authoritative role object and added regression coverage.

Rule: **shadow/audit metadata must not mutate the durable role-output contract.**

---

## Storage, retention, and archive policy

TGserver is the long-term log/evidence archive authority. DebugAI local storage is limited to authoritative durable continuation state plus bounded operational cache.

Runtime Evidence target policy:

```text
retention window   = 12 hours
local byte ceiling = 32 MiB
rotation           = every 15 minutes + startup
```

Recoverable durable runs are not deleted by age alone. Durable run state, manifest, checkpoints, results, effect ledger, and workflow data are treated as a validated run bundle. Terminal durable deletion requires the required archive/receipt condition first.

Default patch-retention safety targets:

```text
unapproved candidate                          7 days
applied backup + verification PASS            72 hours
applied backup + verification FAIL/incomplete 7 days
```

Broad automatic `docker system prune -a --volumes` behavior is forbidden. Active production/runtime volumes must not be removed automatically.

---

## Patch, approval, runtime packets, and repository revision boundaries

Patch generation and patch application are separate operations.

Patch Engineer produces a candidate only. Application requires:

- explicit Master approval decision;
- candidate ID/hash binding;
- application receipt;
- repository policy and revision/snapshot validation.

Repository revision is part of correctness. Final review/completion must refer to the current post-apply repository state rather than a stale revision.

Patch and Review runtime packets are **implemented and wired into the workflow**. Patch Engineer receives a bounded authoritative `debugai.patch-packet/v1`; Local Reviewer receives a fresh `debugai.review-packet/v1`. The required External Final Review receives only a bounded public summary rather than raw repository content. The full deterministic fixture asserts these packet and privacy boundaries.

---

## Strict Completion Gate

`COMPLETE` is a strict conjunction, not a synonym for final-review PASS.

Required conditions:

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

### Implemented and wired

`server/control/completion-gate.js` contains the 11-condition gate plus runtime-input construction/evaluation, and `server/workflow.js` wires that gate into `approveAndVerify()` using runtime-derived inputs.

Focused tests cover missing evidence, missing/mismatched repository revision, unexecuted verification, reviewer UNKNOWN/non-PASS, receipt/candidate mismatch, and related fail-closed cases.

Workflow-level regression additionally proves that:

- both Local Reviewer and External Final PASS are insufficient when a blocking evidence gap exists;
- repository revision drift after apply blocks `COMPLETE`;
- `COMPLETE` is reached only when the strict runtime conjunction passes.

The runtime must not manufacture booleans to satisfy the gate. Candidate identity, receipts, revision snapshots, executed deterministic checks/gates, invariants, reviews, evidence gap, and final-contract validity must come from their authoritative runtime sources.

---

## Control-plane status

### Implemented

- role contracts and model profiles;
- invocation compilation;
- production skill procedures separated from benchmark-specific answers;
- skill registry/procedure execution support;
- read-only Tool Runtime and Tool Risk policy;
- progress/no-progress controller;
- claim/evidence binding and role-output validation;
- runtime telemetry;
- Evidence Projection / Active Evidence Window;
- bounded `evidence.read`;
- current-run `runtime.trace.read` and `state.read`;
- canonical rejected-hypothesis `history.read` without a second history database;
- immutable Master-authority `invariant.read` with runtime-verified invariants kept separate;
- fail-closed deterministic `source.verify`;
- durable tool effects and Researcher continuation;
- Patch / Review runtime packets and workflow wiring;
- repository revision gate components and workflow binding;
- Strict Completion module, runtime-input builder, and workflow wiring;
- deterministic HTTP analyze-to-approved-patch closed-loop fixture;
- external-final public-summary privacy boundary;
- guarded MCP stdio adapter delegating to the existing CLI/HTTP contract;
- MCP durable continuation surface (`start` / exact `run_id` / `status` / `resume` / `wait` / `inspect`);
- Search Gate provider-preserving shadow measurement;
- conservative candidate-skip policy in shadow only;
- read-only Search Gate Shadow Audit CLI;
- bounded read-only live-runtime readback with exact repository identity, fixed source tracking probes, Host↔Container SHA-256 parity for every measurement source, production entrypoint/workdir proof, and exact DebugAI health identity;
- gated one-command live shadow measurement that executes only after all read-only runtime prerequisites pass and can never authorize activation;
- six-role Skill ON/OFF integrated benchmark suite;
- five-axis one-variable Model A/B measurement harness;
- read-only pre-server source qualification audit executed by Verify/Core Verify.

Current control-plane capability audit:

```text
skill contracts                  = 25
skill procedures                 = 25
declared capability requirements = 18
implemented                      = 18
unresolved                       = 0
isGapFree                        = true
```

This means each declared capability has an implemented owning provider/boundary. It does not mean unknown evidence can be turned into a supported fact; `UNKNOWN` and `INSUFFICIENT_*` remain valid fail-closed results.

### Partial / pending

- Search Gate: source/CI shadow instrumentation, candidate policy, read-only store audit, and v3 exact-source live-runtime readback/measurement gate are verified in source/CI; **actual Contabo readback and candidate/false-skip measurement are still NOT EXECUTED**;
- Search Gate production skip activation: NOT EXECUTED and requires real compatible shadow observations plus a separate approval/activation decision;
- six-role Skill ON/OFF: source harness READY; real-model suite NOT EXECUTED;
- Model A/B: source harness READY for `thinking / temperature / top_p / top_k / max_tokens`; real-model measurements NOT EXECUTED;
- fresh real current-runtime self-development/self-debug run: pending;
- final real production-equivalent closed-loop E2E: pending;
- MCP live Contabo runtime connection and VS Codex/Workspace registration: pending and explicitly delegated to the VS Codex live-server phase.

Do not mechanically turn every future gap into an AI tool. Responsibilities may belong to deterministic core, runtime packets, repository/runtime policy, benchmark harnesses, or other non-AI boundaries.

---

## Current model performance baseline

Recorded generation profile for the active model/server setup:

```text
Qwen2.5-Coder 7B   14.66 tok/s
Qwen3 8B            4.18 tok/s
Granite 4.2 8B      5.82 tok/s
Ministral 3 8B      7.98 tok/s
```

Current production sampling baseline remains `temperature=0`; production does not change merely because the benchmark harness can send explicit `top_p` / `top_k` candidates.

Model A/B real measurement is not yet complete. Use the exact GGUF and current llama.cpp/llama-swap environment and change one variable at a time: thinking -> sampling -> token cap. The source harness counterbalances execution order and accepts repository-recorded official sampling candidates where available. Official recommended settings are measurement candidates, not automatic production settings.

Qwen Coder parallel-use/environment experimentation is currently separate/on hold and must not block DebugAI core work.

---

## HTTP API

The server listens on loopback by default (`127.0.0.1:8787`).

Current runtime routes include:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | runtime health / approval-boundary status |
| GET | `/v1/status/:run_id` | current run status |
| GET | `/v1/inspect/:run_id` | retained/redacted run inspection |
| POST | `/v1/analyze` | analysis workflow |
| POST | `/v1/runs/start` | start durable async analysis |
| POST | `/v1/runs/resume` | resume a recoverable durable analysis run |
| POST | `/v1/patch-candidate` | create patch candidate after allowed hypothesis-review state |
| POST | `/v1/verify` | read-only verification |
| POST | `/v1/approve-apply-verify` | explicit approval, apply, deterministic retest, review, Strict Completion path |
| POST | `/v1/assets/promote` | promote validated knowledge asset |

Durable state underneath an endpoint does not automatically prove every real async/resume client scenario. API behavior must still be verified in the runtime scenario being claimed.

---

## CLI / MCP / external parent-agent integration

DebugAI is callable from VS Code, Cursor, Codex, ChatGPT-driven terminal work, or another parent developer agent through the existing CLI/HTTP interface and the guarded MCP stdio adapter.

Current CLI commands include:

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

Current MCP tools:

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

The MCP continuation flow is intentionally multi-call rather than one-shot:

```text
debugai_start -> exact run_id -> debugai_status -> debugai_resume when applicable -> debugai_wait -> debugai_inspect
```

Important boundaries:

- `debugai patch` and `debugai_patch_candidate` create a candidate only;
- `debugai verify` / `debugai_verify` are read-only;
- CLI stdout is machine-readable JSON;
- the MCP adapter delegates to the existing `bin/debugai.js` execution contract;
- neither CLI nor MCP exposes a shortcut that silently approves/applies a patch;
- mutation remains behind explicit approval using the exact candidate identity.

CLI/MCP usage is documented in [`DEBUGAI.md`](DEBUGAI.md), the MCP-specific design/verification boundary is documented in [`docs/MCP_ADAPTER.md`](docs/MCP_ADAPTER.md), the pre-server benchmark boundary is documented in [`docs/PRE_SERVER_QUALIFICATION.md`](docs/PRE_SERVER_QUALIFICATION.md), and the live VS Codex handoff is documented in [`docs/CODEX_MCP_LIVE_HANDOFF.md`](docs/CODEX_MCP_LIVE_HANDOFF.md).

Run the MCP stdio entry with:

```bash
npm run debugai:mcp
```

or after linking:

```bash
debugai-mcp
```

The MCP stdio protocol has been verified in current exact-head CI with the official MCP client, but live Contabo DebugAI runtime connection and VS Codex/Workspace registration remain `NOT_VERIFIED / NOT_EXECUTED`.

---

## Repository layout

- `server/` — live server runtime, workflow, adapters, patch/runtime services, control plane, native helper source, tests.
- `server/control/` — role/tool/skill/evidence/progress/recovery/packet/completion/benchmark control modules.
- `server/tests/` — adapter, workflow, security, durable, benchmark, fault, completion, storage, and regression tests.
- `orchestrator/` — platform-neutral canonical cores and durable contracts/primitives.
- `tests/` — repository-level contract/integration tests.
- `mcp/` — guarded MCP adapter, module map, and MCP protocol/contract tests; does not own workflow or mutation authority.
- `bin/debugai.js` — existing CLI/HTTP client integration.
- `bin/debugai-mcp.mjs` — MCP stdio entrypoint.
- `scripts/pre-server-qualification-audit.cjs` — read-only source readiness audit; never converts source readiness into a real benchmark/runtime PASS.
- `legacy/pc-authority/` — preserved PC/Windows authority and regression material; not the current server runtime.
- `docs/` — active design authority and supporting documentation, including pre-server qualification, MCP adapter contract, and VS Codex live MCP handoff.
- `artifacts/benchmark-runs/` — canonical ignored location for benchmark-run evidence generated by the repository benchmark tooling.
- `Dockerfile` / `compose.yaml` — server image/residency/security/runtime configuration.

---

## Runtime configuration

Never commit secret values.

### AI Core

```text
DEBUG_AI_CORE_URL
AI_CORE_API_KEY
```

### Evidence Search

```text
DEBUG_AI_EVIDENCE_SEARCH_URL
DEBUG_AI_EVIDENCE_SEARCH_SECRET_HOST_PATH
DEBUG_AI_EVIDENCE_SEARCH_CALLER_ID
```

The credential is mounted read-only inside the container through the configured secret-file path.

### TGserver

```text
DEBUG_AI_TGSERVER_URL
DEBUG_AI_TGSERVER_LOG_PROJECT_ID
DEBUG_AI_TGSERVER_KB_PROJECT_ID
```

### Repository/workspace policy

```text
DEBUG_AI_REPO_ALLOWLIST
DEBUG_AI_WORKSPACE_HOST_PATH
```

The host workspace is mounted under the container workspace contract. Repository operations must remain within policy/allowlist boundaries.

### Deterministic tooling

```text
DEBUG_AI_OSV_DB_HOST_PATH
DEBUG_AI_TOOLS_HOST_PATH
```

### External review

```text
GROQ_API_KEY
GEMINI_API_KEY
DEBUG_AI_GROQ_URL
DEBUG_AI_GEMINI_URL
```

External providers are review services, not patch-application authorities.

---

## Container/security boundary

The current server design uses Docker/Compose with:

- loopback application binding (`127.0.0.1:8787`);
- `debug-ai` as the application Compose service;
- host workspace mounted to `/workspace`;
- no-new-privileges/capability reduction;
- controlled durable storage;
- repository policy/allowlist boundaries;
- read-only credential/tool mounts where applicable;
- sandbox and DAP isolation controls;
- bounded operational logging.

Do not install persistent host Node/npm or create production-only source edits as a shortcut around the container/source contract.

---

## Development and verification

Required Node.js runtime:

```text
24.20.0
```

Install and run the repository verification:

```bash
npm install
npm run verify
```

`npm run verify` performs the durable native build, JavaScript syntax checks, repository/server/MCP tests, and the read-only pre-server source qualification audit.

Useful explicit commands:

```bash
npm run test:e2e-fixture
npm run audit:control-plane-gaps
npm run audit:docker-storage
npm run audit:search-gate-shadow
npm run audit:pre-server-qualification
npm run audit:live-runtime
npm run benchmark:local-reviewer
npm run benchmark:skill-effect-all
npm run benchmark:model-ab -- --role <role> --axis <thinking|temperature|top_p|top_k|max_tokens> --candidate <value|official> --repeats <1..5>
npm run test:legacy
npm run debugai:mcp
```

`audit:pre-server-qualification` is read-only. A `source_ready=true` result means the required benchmark/MCP/live-readback source entry points are coherent; every real benchmark/runtime result remains explicitly `NOT_EXECUTED_BY_SOURCE_AUDIT`.

`audit:search-gate-shadow` is read-only. It does not call search providers, mutate RuntimeEvidence, deploy/restart services, or authorize Search Gate activation.

`audit:live-runtime` is also read-only. It verifies exact repository identity, bounded tracked-source state, Host↔Container SHA-256 parity for all measurement-critical source, the production `node server/main.js` entrypoint with `/app` workdir, and the exact DebugAI loopback health identity. Only when every prerequisite passes does it invoke the container's existing read-only shadow audit against `/app/runtime`; otherwise measurement is not executed. It never pulls, resets, merges, deploys, restarts/recreates a service, changes a Secret, calls a search provider, or authorizes Search Gate activation.

`debugai verify` is read-only and the CLI/MCP surfaces intentionally do not expose a patch-apply shortcut.

---

## Current verified snapshot and CI boundary

### Current pre-server source snapshot

For exact implementation/documentation HEAD `a7006347952808fe4ba017c51120fad436b8a6bc`, GitHub workflows were read back as:

```text
Public Readiness Audit = SUCCESS (#352)
Verify                 = SUCCESS (#387)
Core Verify            = SUCCESS (#388)
```

The `Verify` workflow executed:

```text
tests     = 370
pass      = 370
fail      = 0
cancelled = 0
skipped   = 0
todo      = 0
```

The same Verify run executed `audit:pre-server-qualification` and read back:

```text
source_ready                         = true
local_reviewer_runner                = true
six_role_skill_suite                 = true
model_ab_runner                      = true
model_ab_sampling_scope              = true
model_ab_official_candidates         = true
mcp_exact_nine_tools                 = true
required_scripts                     = true
required_docs                        = true
production_profile_change_authorized = false
server_mutation_authorized           = false
all real measurements                = NOT_EXECUTED_BY_SOURCE_AUDIT
```

The A/B regressions prove one-axis changes, explicit thinking eligibility, temperature/top_p/top_k candidate-only sampling requests, omitted baseline top_p/top_k, official-candidate fail-closed behavior, counterbalanced execution order, dynamic scorer ceilings, bounded repeats, and non-promotion of quality regressions or improvements.

Core Verify additionally passed the current real CI gates for DebugAI image build/container health, Landlock+seccomp isolation, loopback-only/managed Node and Python DAP, main-to-sidecar queue round trip, and Compose sandbox boundary.

PR #34 is still OPEN / DRAFT / UNMERGED. These source/CI results do not prove live server identity, real model benchmark outcomes, real VS Codex MCP registration, or a real Search Gate false-skip measurement.

### Previous MCP/live-readback snapshot

PR #33 source/docs HEAD `cfbe2908bb6190bc5f5c894779c4d0f08f51b80e` previously passed its exact 355/355 source/CI boundary. PR #34 is stacked on that verified head and does not replace historical proof with assumption.

### Historical MCP implementation snapshot

Exact MCP implementation SHA `078203e61073be99a48444ba0c3467a7143102f4` passed its then-current 286/286 suite and real stdio regression. It remains historical evidence only.

---

## Current implementation status

| Area | Status |
| --- | --- |
| Durable primitives / writer lock / generation+epoch fencing | IMPLEMENTED + VERIFIED |
| RoleCheckpoint / RoleResult | IMPLEMENTED + VERIFIED |
| Effect Ledger / replay-safe effect reuse | IMPLEMENTED + VERIFIED |
| Researcher A/B/C/D/E continuation | IMPLEMENTED + VERIFIED |
| Real SIGKILL restart regression | VERIFIED PASS |
| Runtime Evidence retention/security | IMPLEMENTED + VERIFIED |
| Terminal archive/GC safety boundary | IMPLEMENTED + VERIFIED boundary |
| AI Core telemetry | IMPLEMENTED |
| Role Tool Loop telemetry | IMPLEMENTED |
| Production skill/benchmark isolation | IMPLEMENTED + VERIFIED |
| Evidence Projection + Active Evidence Window | IMPLEMENTED + CONNECTED |
| `evidence.read` | IMPLEMENTED + TESTED |
| `runtime.trace.read` / `state.read` | IMPLEMENTED + TESTED |
| `history.read` | IMPLEMENTED + TESTED |
| `invariant.read` | IMPLEMENTED + TESTED |
| `source.verify` | IMPLEMENTED + TESTED, FAIL-CLOSED |
| Control-plane declared capability requirements | 18/18 IMPLEMENTED / 0 UNRESOLVED |
| Repository revision fallback/binding | IMPLEMENTED + TESTED |
| Patch / Review Packet workflow wiring | IMPLEMENTED + TESTED |
| Strict Completion Gate module | IMPLEMENTED + TESTED |
| Strict Completion runtime-input builder | IMPLEMENTED + TESTED |
| Strict Completion workflow wiring | IMPLEMENTED + TESTED |
| Deterministic full analyze→approved patch fixture | PASS |
| External final public-summary privacy boundary | TESTED |
| CLI start/resume/wait/patch/verify/status/inspect contract | IMPLEMENTED + TESTED |
| MCP adapter source / unit contract | IMPLEMENTED + VERIFIED |
| MCP real stdio protocol / tools/list / health call | VERIFIED PASS IN CURRENT CI |
| MCP durable start/status/resume/wait/inspect surface | IMPLEMENTED + VERIFIED BY CONTRACT/CI |
| VS Codex live MCP handoff | DOCUMENTED / LIVE NOT EXECUTED |
| MCP live Contabo DebugAI runtime | NOT VERIFIED |
| Workspace MCP registration | NOT EXECUTED |
| Search Gate provider-preserving shadow | SOURCE + CI VERIFIED |
| Search Gate candidate-skip policy | SHADOW ONLY / SOURCE + CI VERIFIED |
| Search Gate read-only audit CLI | SOURCE + CI VERIFIED |
| Live-runtime v3 exact-parity readback + gated shadow measurement | SOURCE + CI VERIFIED / LIVE NOT EXECUTED |
| Real live Search Gate candidate/false-skip measurement | NOT EXECUTED |
| Search Gate skip activation | NOT EXECUTED / NOT AUTHORIZED BY SHADOW AUDIT |
| Six-role Skill ON/OFF integrated runner | SOURCE + CI VERIFIED / REAL NOT EXECUTED |
| Model A/B five-axis runner | SOURCE + CI VERIFIED / REAL NOT EXECUTED |
| Pre-server source qualification audit | SOURCE + CI VERIFIED / `source_ready=true` |
| Fresh real current-runtime self-development run | NOT EXECUTED |
| Real production-equivalent full closed-loop E2E | PENDING |
| Main merge | NOT DONE / NOT AUTHORIZED |
| Deploy / production change | NOT DONE |

DebugAI as a whole is therefore **not yet fully complete**. The source/CI/MCP/benchmark-harness boundary is ready for live verification and measurement, while the actual server/model/Codex/runtime boundary must still be measured rather than assumed.

---

## Required next-work order

Current order is:

```text
1. keep PR #34 exact-head source/CI/documentation synchronized; do not merge or deploy
2. VS Codex reads current server-core authority, then actual live DebugAI checkout/runtime read-only
3. run `npm run audit:pre-server-qualification` on compatible live source; source READY is not a real benchmark PASS
4. run `npm run audit:live-runtime`; if behind/incompatible, record RUNTIME_SOURCE_BEHIND_OR_UNKNOWN and stop before sync/deploy/restart
5. on already-compatible runtime, run Local Reviewer real benchmark and six-role Skill ON/OFF suite
6. run one-variable Model A/B in design order: Thinking where applicable -> Sampling (temperature/top_p/top_k with justified candidates) -> token cap
7. in the real Codex execution context, verify exact nine MCP tools -> health -> durable start -> exact run_id status -> resume only if applicable -> bounded wait -> inspect
8. run a bounded real current-runtime DebugAI self-development/self-debug case against an explicitly allowed repository
9. preserve actual TGserver/Evidence Search use or non-use; do not manufacture provider traffic merely to mark a box PASS
10. evaluate the read-only Search Gate Shadow Audit when source/runtime is compatible: no candidates / incompatible policy / non-evaluable / false-skip detected / zero observed
11. do not activate search skipping from the audit alone; limited activation requires a separate safety decision and explicit approval boundary
12. bind fresh real-run findings to current repository/runtime evidence and fix only confirmed source defects
13. focused regression + repository verification + exact-SHA CI + read-only DebugAI verify
14. final real production-equivalent closed-loop E2E
15. PR final audit
16. wait for explicit Master approval before merge/deploy/profile change
```

Do not return to older status documents that list already completed durable, packet, Strict Completion, Role Semantic, Evidence Projection, benchmark leakage isolation, MCP source/protocol, or the closed 18/18 control-plane capability boundary as pending work.

---

## Final real closed-loop acceptance

Project-level completion still requires a real current-runtime run covering the intended production path, including at minimum:

- unknown/insufficient evidence handling;
- real repository defect or an explicitly verified no-defect outcome for the chosen target;
- prompt-injection resistance;
- stale revision rejection;
- durable SIGKILL resume;
- patch candidate generation when a confirmed defect requires a patch;
- explicit approval boundary;
- application receipt when mutation is approved;
- deterministic retest;
- invariants;
- fresh Local Reviewer;
- required External Final Review;
- Strict Completion Gate using actual runtime evidence.

A deterministic fixture, source-only CI result, pre-server source audit, Search Gate shadow fixture, or MCP transport test alone is not enough.

---

## Deployment rule

Server source changes follow this order:

```text
GitHub feature branch
 -> focused tests
 -> repository verification / exact-SHA CI
 -> PR audit
 -> explicit Master approval
 -> merge to main
 -> Contabo source sync
 -> Docker image build
 -> container recreate
 -> health/readiness
 -> real runtime E2E
```

Do not silently pull/reset/sync the live server because GitHub advanced. Do not treat an older server checkout as current branch source.

---

## README synchronization rule

README is part of the development handoff contract, not an archival snapshot. When a development step changes the implemented/pending boundary, verification boundary, runtime entry point, role/tool responsibility, safety gate, or required next-work order, README must be updated in the same development sequence after the implementation/test state is known.

Do not intentionally leave already-completed work listed as pending and rely on readers to ignore it. Historical implementation snapshots may be mentioned as history, but the Current State sections must track the latest verified branch state.

---

## Safety boundaries

DebugAI must never become:

- a second state engine beside `RunAuthority`;
- an autonomous patch applier without explicit approval;
- a system that turns model confidence into evidence;
- a system that marks missing evidence as PASS;
- a system that replays mutation-capable effects automatically after restart;
- a system that stores hidden chain-of-thought or credentials in durable state;
- a system that calls final-review PASS `COMPLETE` without the strict completion conjunction;
- a system that promotes a benchmark candidate directly into production configuration;
- a reason to weaken repository, sandbox, revision, review, retention, or verification controls for speed.

Its purpose is to make debugging faster and cheaper **without sacrificing evidence, verification, approval, recovery, and security correctness**.
