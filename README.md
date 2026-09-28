# DebugAI

DebugAI is a code-first, evidence-driven debugging runtime for G-ACE development workflows. It coordinates local AI roles, deterministic runtime evidence, authoritative evidence lookup, external review, patch generation, explicit human approval, retest, final review, and knowledge promotion without giving any single model unrestricted control of the debugging loop.

> **Canonical rule:** this GitHub repository is the source of truth. Contabo production deployment is performed only from code already committed and verified here.

## Active design authority

Durable continuation and resumable AI execution are governed by:

- [`docs/DURABLE-CONTINUATION-DESIGN.md`](docs/DURABLE-CONTINUATION-DESIGN.md)

That document is the development authority for the current durable-continuation branch. Implementation must not drift from it silently.

The central completion condition is not merely "state was saved". DebugAI must prove this exact behavior:

```text
A completes and is durably committed
B completes and is durably committed
C starts
C is interrupted
process restarts
same run_id is restored
same role_execution_id is restored
new attempt is created
A is reused and NOT re-executed
B is reused and NOT re-executed
execution continues from C
RoleResult is durably committed
Diagnoser consumes the saved/restored upstream RoleResult
```

Until that path is actually executed and verified, durable continuation remains incomplete.

## What DebugAI does

DebugAI implements a guarded debugging loop:

```text
Failure / local evidence
        |
        v
Code Scout + Causal Scout
        |
        +----> TGserver knowledge search
        |
        +----> Evidence Search
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
        v
WAITING_MASTER_APPROVAL
        |
        | explicit approve only
        v
Apply patch -> deterministic retest
        v
Local Reviewer
        v
External Final Review
        |
        v
COMPLETE or blocked/pending state
```

The runtime is deliberately fail-closed at approval, repository scope, external review schema, provider/authentication, durable execution, and execution-critical boundaries. Evidence insufficiency is represented as an explicit evidence gap instead of being silently converted into proof.

## Durable continuation: runtime and AI-side behavior

The current development work has two equally important layers.

### Runtime execution layer

The runtime must be able to:

- durably save authoritative progress;
- reject stale writers;
- preserve `run_id`, `role_execution_id`, attempt, generation, and execution epoch;
- survive process restart;
- restore checkpoints and results;
- resume from the correct workflow position;
- preserve retry, timeout, cancellation, budget, and no-progress state;
- expose recoverable state through status/inspection interfaces.

### AI execution layer

AI roles must be able to:

- know which work units are already complete;
- reuse committed deterministic/read-only tool results;
- avoid repeating completed searches, reads, and tool effects;
- continue from the next unfinished work unit;
- preserve role progress without storing hidden chain-of-thought;
- commit a durable `RoleResult`;
- allow downstream roles to consume saved upstream results without rerunning completed upstream roles.

`Researcher` is the first mandatory full continuation case. The target is not just server restart safety; it is an AI role that can actually continue the same logical investigation after interruption.

## Current durable architecture status

On branch `feat/durable-role-continuation-final-20260928`, the following foundations are committed:

- hardened RuntimeEvidence retention/security boundary;
- canonical durable primitives and envelopes;
- `DurableFileIO`;
- Linux native single-writer lock foundation;
- durable run-state / execution-manifest contracts;
- monotonic `generation`;
- `execution_epoch` fencing;
- authoritative commit protocol;
- durable `RoleCheckpoint`;
- durable `RoleResult` separated from the overall run result;
- durable `Effect Ledger` contract and reuse policy;
- `Researcher` Work Unit Registry for A/B/C/D/E continuation.

Current implementation order is fixed by the design authority:

```text
1. Durable storage / writer lock                     committed
2. Generation / epoch / commit protocol             committed
3. RoleCheckpoint / RoleResult                      committed
4. Effect Ledger                                    committed
5. Work Unit Registry                               committed
6. Tool Loop / ProgressController durable hook      next
7. Researcher continuation                          next
8. Workflow cursor / start-vs-resume
9. Startup recovery
10. Async HTTP API / CLI compatibility
11. Migration / rollback guard / retention / GC
12. Unit + integration + fault-injection regression
13. Exact A/B -> C restart acceptance E2E
```

Do not skip ahead and treat later stages as complete because storage foundations exist.

### Current verification boundary

Already observed during focused development before this README update:

- RuntimeEvidence boundary tests: `8/8 PASS`;
- durable focused contract/commit tests: `7/7 PASS`;
- durable storage syntax gate: `PASS`.

The Effect Ledger / Work Unit Registry source and focused test have now been committed, but their test result remains `NOT_VERIFIED` until executed on the branch after the commit.

Not yet proven:

- native writer-lock real runtime test in the required Node 24.20.0/native-addon build environment;
- Effect Ledger focused test execution after commit;
- Work Unit Registry focused test execution after commit;
- real Researcher continuation;
- durable Tool Loop / ProgressController integration;
- workflow cursor recovery;
- startup recovery;
- async API/CLI continuation behavior;
- migration/rollback/retention/GC completion;
- required fault-injection suite;
- final A/B -> C restart -> RoleResult -> Diagnoser E2E.

These items must remain `NOT_VERIFIED` until actually executed.

## Current server architecture

### Internal AI roles

All internal AI execution goes through the AI Core API. DebugAI does not directly manage llama.cpp ports or model processes.

| Role | Runtime authority | Thinking | Purpose |
| --- | --- | --- | --- |
| Code Scout | Qwen2.5-Coder 7B | provider default | code-oriented failure inspection |
| Causal Scout | Qwen3 8B | disabled | independent causal hypothesis |
| Researcher | Granite 4.2 8B | disabled | select decisive evidence and preserve evidence gaps |
| Diagnoser | Qwen3 8B | enabled | falsifiable diagnosis |
| Patch Engineer | Qwen2.5-Coder 7B | provider default | candidate generation only; never applies |
| Local Reviewer | Ministral 3 8B Reasoning | provider default | deterministic-result review |

Role runtime budgets are enforced by the server control layer. Long-running roles such as Causal Scout, Researcher, Diagnoser, and Local Reviewer have extended bounded execution budgets; Code Scout and Patch Engineer retain tighter role-specific bounds. Durable continuation does not remove those limits: it makes interruption/retry/resume explicit instead of treating process lifetime as the logical work lifetime.

### External review

External providers are restricted to two review boundaries:

1. **Hypothesis Review** — before patch generation.
2. **Final Review** — after apply/retest/local review.

Groq is the primary external reviewer. Gemini is available as a second-opinion/fallback path. Provider decision shapes are normalized to the canonical contract:

```text
verdict = PASS | FAIL | PENDING
```

Recognized provider aliases such as `APPROVED` / `REJECTED` are normalized without weakening the gate. Unknown decision shapes fail closed with `EXTERNAL_REVIEW_SCHEMA`.

### Evidence Search

DebugAI accesses Astera Evidence Search only through its internal API. Requests are HMAC-signed with the configured internal-service credential.

The adapter enforces:

- expected Evidence Search result schema;
- `ai_used === false`;
- `payment_executed === false`;
- free-only search policy;
- `FINAL_VALID` as the authoritative-evidence success state.

A non-final search result such as `REJECTED_INITIAL_QUALITY` is carried forward as:

```text
evidence_gap = true
```

It is not treated as authoritative evidence. Missing evidence is never silently upgraded into support for a claim.

### TGserver

TGserver is used through HTTP APIs only. DebugAI does not directly access Telegram, Redis, or Meilisearch.

Two independent project IDs are required:

- runtime log project;
- knowledge-base project.

The adapter redacts known credential fields before ingestion. Knowledge promotion and knowledge retrieval are separate from runtime logging.

## Durable execution contracts

### Single authority

`RunAuthority` remains the single authoritative execution/state owner. Durable continuation must extend the current runtime, not introduce a second orchestrator or competing state engine.

### Durable identity

The following identities are distinct and must remain distinct:

```text
run_id
role_execution_id
attempt
generation
execution_epoch
```

A restart of the same logical role execution keeps the same `role_execution_id` and creates a new attempt where appropriate.

### RoleCheckpoint

A `RoleCheckpoint` records enough explicit structured execution state to continue work after interruption. It is for workflow state, evidence/tool references, work-unit progress, retry/cancellation/progress metadata, and continuation inputs. It must not contain hidden model chain-of-thought.

### RoleResult

A `RoleResult` is a durable result of one AI role execution. It is deliberately separate from the overall `result/v1` run result and cannot by itself claim the whole DebugAI run is `COMPLETE`.

### Effect Ledger

The `Effect Ledger` gives committed deterministic/read-only tool effects a stable logical identity and allows reuse only when the input binding, repository snapshot, tool contract, environment, referenced result, result digest, and freshness/reference policy still match. Mutation-capable actions never gain automatic replay authority.

### Work Unit Registry

The `Work Unit Registry` defines stable resumable Researcher work units, dependencies, completion rules, reuse policy, and next-work selection. Researcher currently uses A/B/C as independent evidence-gathering units, D for contradiction reconciliation after A/B/C, and E for final evidence-selection assembly. It must integrate with the existing Tool Loop and ProgressController rather than becoming a second progress/orchestration system.

## HTTP API

The server listens on loopback by default (`127.0.0.1:8787`).

Current public runtime routes include:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | runtime health and approval-boundary status |
| GET | `/v1/status/:run_id` | current run status |
| GET | `/v1/inspect/:run_id` | retained/redacted run inspection |
| POST | `/v1/analyze` | scouts -> knowledge/evidence -> research -> diagnosis -> external hypothesis review |
| POST | `/v1/patch-candidate` | generate a patch candidate after external hypothesis PASS |
| POST | `/v1/verify` | read-only verification |
| POST | `/v1/approve-apply-verify` | explicit approval, apply, deterministic retest, local review, external final review |
| POST | `/v1/assets/promote` | promote a validated knowledge asset to TGserver |

Durable continuation will add asynchronous run lifetime semantics so client connection lifetime is no longer the execution lifetime. That behavior is still under development and must not be described as complete until implemented and tested.

## Workflow states and approval

Important states emitted by the runtime include the current orchestrator state model plus server-level workflow decisions such as waiting for explicit approval, retest failure, external review, and completion.

Patch generation and patch application remain separate operations.

`/v1/patch-candidate` cannot authorize apply.

`/v1/approve-apply-verify` requires an explicit approval decision and validates the referenced candidate/hash/repository contract before mutation.

Startup recovery and durable continuation must never bypass this boundary.

## Repository layout

- `server/` — current server, workflow, adapters, patch/runtime services, control plane, native helper source, and server tests.
- `orchestrator/` — platform-neutral canonical cores plus durable storage/commit/checkpoint contracts reused by the server runtime.
- `tests/` — server-level/integration contract tests.
- `server/tests/` — adapter, workflow, failure-path, security, durable-storage, and runtime contract tests.
- `legacy/pc-authority/` — preserved Windows/PC DebugAI authority code and regression tests; not the current server runtime.
- `docs/` — active design authorities, migration material, manifests, policy, and supporting technical documentation.
- `Dockerfile` — server image definition.
- `compose.yaml` — server residency, mounts, security options, and required runtime configuration.

## Runtime configuration

Do not commit secret values.

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

Inside the container the credential is mounted read-only and referenced through `DEBUG_AI_EVIDENCE_SEARCH_SECRET_FILE`.

### TGserver

```text
DEBUG_AI_TGSERVER_URL
DEBUG_AI_TGSERVER_LOG_PROJECT_ID
DEBUG_AI_TGSERVER_KB_PROJECT_ID
```

### Workspace and repository policy

```text
DEBUG_AI_REPO_ALLOWLIST
DEBUG_AI_WORKSPACE_HOST_PATH
```

The host workspace is mounted at `/workspace`. Repository operations are expected to resolve within the configured workspace and allowlist boundary.

### Deterministic tooling

```text
DEBUG_AI_OSV_DB_HOST_PATH
DEBUG_AI_TOOLS_HOST_PATH
```

These are mounted read-only into the container for OSV/tool-backed checks.

### External review

```text
GROQ_API_KEY
GEMINI_API_KEY
DEBUG_AI_GROQ_URL
DEBUG_AI_GEMINI_URL
```

At least one configured external reviewer is required by the server bootstrap.

## Container security / residency

The server runtime uses Docker/Compose security boundaries including:

- loopback application binding;
- no-new-privileges;
- Linux capability reduction;
- durable runtime state under controlled storage;
- workspace access constrained by repository policy;
- read-only mounts for tooling/credentials where applicable;
- sandbox/DAP isolation controls for debug execution paths.

Do not bypass the runtime contract with ad-hoc production-only source edits.

## Development and verification

Required Node.js runtime:

```text
24.20.0
```

### VS Code / Cursor / Codex CLI

The supported terminal entry point is documented in [DEBUGAI.md](DEBUGAI.md).

```bash
npm link
debugai health
debugai analyze "investigate the current failure"
debugai verify --repo /workspace/my-repo
```

CLI stdout is formal JSON. `debugai verify` is read-only and is not an alias for `/v1/approve-apply-verify`; the CLI intentionally has no patch-apply command.

### Repository verification

```bash
npm install
npm run verify
```

Run the deterministic HTTP closed-loop fixture before any live real-repository E2E:

```bash
npm run test:e2e-fixture
```

Inspect the executable Skill procedure and Tool gaps without invoking AI Core:

```bash
npm run audit:control-plane-gaps
```

Legacy PC authority regression tests remain separate:

```bash
npm run test:legacy
```

## Durable continuation acceptance gates

Development must not claim completion until the following categories are executed:

### Unit

- generation monotonicity;
- stale generation rejection;
- epoch fencing;
- stable role execution identity;
- attempt increment behavior;
- checkpoint validation;
- RoleResult validation;
- Effect Ledger reuse/integrity;
- work-unit progression;
- no-progress restoration;
- migration/rollback/retention safety.

### Integration

- start -> checkpoint -> resume;
- Researcher partial completion -> restart -> continuation;
- Diagnoser consumes saved Researcher RoleResult;
- async API start/status/result;
- idempotent repeated client start;
- legacy API/CLI compatibility;
- PatchService approval boundary unchanged.

### Fault injection

- kill after A;
- kill after B;
- timeout/cancel during C;
- HTTP client disconnect;
- restart during recoverable role;
- stale writer commit after epoch bump;
- corrupt checkpoint;
- missing effect result;
- effect hash mismatch;
- duplicate resume.

### Final exact E2E

```text
A committed
B committed
C interrupted
process restart
same run_id
same role_execution_id
new attempt
A reused, not executed
B reused, not executed
C continues
RoleResult committed
Diagnoser consumes restored result
```

## Deployment rule

Server changes follow this order:

```text
GitHub branch
 -> focused tests
 -> repository verification / CI
 -> pull request
 -> merge to main
 -> Contabo git sync
 -> Docker image build
 -> container recreate
 -> /health
 -> real E2E gate
```

Do not make production-only source edits on Contabo and then treat them as canonical.

## Safety boundaries

The following are intentional system boundaries, not optional conventions:

- **RunAuthority remains the execution authority.** Durable continuation does not create a second state engine.
- **AI Core is a separate service.** DebugAI consumes it through the API and does not rewrite AI Core internals.
- **External AI cannot apply code.** External providers review hypotheses/final results only.
- **Patch Engineer cannot apply code.** It creates a candidate only.
- **Patch application requires explicit approval.** A generated candidate is not authorization to write.
- **Durable replay never grants mutation authority.** Already-saved read-only/deterministic effects may be reused only when integrity/binding checks pass.
- **Evidence Search is authoritative only when its result is final-valid.** Rejected/insufficient evidence remains uncertainty.
- **TGserver is API-only.** Direct Telegram/Redis/Meilisearch access is outside the DebugAI runtime contract.
- **Secrets must never be emitted to logs or committed to this repository.**
- **Raw hidden chain-of-thought must not be persisted.**
- **Repository writes must stay inside the workspace/allowlist boundary.**

## Runtime validation status

Real Contabo validation before the durable-continuation branch demonstrated major existing DebugAI runtime paths, including internal AI roles, Evidence Search, TGserver adapters, external-review reach, and `/v1/analyze` execution.

The new durable-continuation branch must be judged separately. Existing runtime success is not proof that restart/resume is complete.

Current durable status:

```text
storage foundation                implemented / partially focused-tested
single-writer foundation           implemented / real native runtime gate pending
generation + epoch fencing         implemented / focused-tested
commit protocol                    implemented / focused-tested
RoleCheckpoint                     implemented / focused-tested
RoleResult                         implemented / focused-tested
Effect Ledger                      implemented / post-commit test pending
Work Unit Registry                 implemented / post-commit test pending
Tool Loop durable integration      pending
Researcher real continuation       pending
workflow/startup recovery          pending
async API/CLI continuation         pending
migration/retention/GC             pending
fault-injection suite              pending
final restart E2E                  pending
```

The project must not be called durable-continuation complete while any required final gate remains pending.

## Non-goals

DebugAI is not:

- an unrestricted autonomous code writer;
- a replacement for AI Core routing/model residency;
- a direct TGserver storage client;
- a direct Evidence Search implementation;
- a mechanism for bypassing explicit patch approval;
- a reason to treat weak or missing evidence as authoritative fact.

Its job is to make debugging faster **without removing evidence, verification, repository, approval, recovery, and security boundaries**.
