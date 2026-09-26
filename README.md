# DebugAI

DebugAI is a code-first, evidence-driven debugging runtime for G-ACE development workflows. It coordinates local AI roles, deterministic runtime evidence, authoritative evidence lookup, external review, patch generation, explicit human approval, retest, final review, and knowledge promotion without giving any single model unrestricted control of the debugging loop.

> **Canonical rule:** this GitHub repository is the source of truth. Contabo production deployment is performed only from code already committed and verified here.

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

The runtime is deliberately fail-closed at approval, repository scope, external review schema, provider/authentication, and execution-critical boundaries. Evidence insufficiency is represented as an explicit evidence gap instead of being silently converted into proof.

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

The Researcher and Diagnoser have role-specific 180 s timeouts. Code Scout, Causal Scout, Patch Engineer, and Local Reviewer retain the default 120 s timeout. These role-specific budgets are based on real Contabo measurements: the thinking-enabled Diagnoser was measured close to the previous 120 s ceiling, and the Researcher later hit the default 120 s boundary on a larger real-repository evidence payload while both scouts completed well below that limit.

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

It is not treated as authoritative evidence, but it does not by itself crash the whole diagnostic workflow. The gap is scoped to authoritative Evidence Search; supplied local evidence remains available to Researcher, Diagnoser, and the sanitized external hypothesis review path.

### TGserver

TGserver is used through HTTP APIs only. DebugAI does not directly access Telegram, Redis, or Meilisearch.

Two independent project IDs are required:

- runtime log project;
- knowledge-base project.

The adapter redacts known credential fields before ingestion. Knowledge promotion and knowledge retrieval are separate from runtime logging.

## HTTP API

The server listens on loopback by default (`127.0.0.1:8787`).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | runtime health and approval-boundary status |
| POST | `/v1/analyze` | scouts -> knowledge/evidence -> research -> diagnosis -> external hypothesis review |
| POST | `/v1/patch-candidate` | generate a patch candidate after external hypothesis PASS |
| POST | `/v1/approve-apply-verify` | explicit approval, apply, deterministic retest, local review, external final review |
| POST | `/v1/assets/promote` | promote a validated knowledge asset to TGserver |

Request bodies are capped at 2 MB. Unhandled workflow errors are returned as JSON error responses.

## Workflow states

Important states currently emitted by the server include:

```text
HYPOTHESIS_APPROVED
AWAITING_EXTERNAL_HYPOTHESIS_REVIEW
WAITING_MASTER_APPROVAL
FAILED_RETEST
AWAITING_EXTERNAL_FINAL_REVIEW
COMPLETE
```

`/v1/patch-candidate` refuses to run unless the external hypothesis verdict is exactly `PASS`.

`/v1/approve-apply-verify` refuses patch application unless `decision` is exactly `approve` and the patch service validates the referenced candidate/hash/repository contract.

## Repository layout

- `server/` — current production server, workflow, adapters, patch/runtime services, and server tests.
- `orchestrator/` — platform-neutral canonical cores reused by the server runtime.
- `tests/` — server-level/integration contract tests.
- `server/tests/` — adapter, workflow, failure-path, security, and runtime contract tests.
- `legacy/pc-authority/` — preserved Windows/PC DebugAI authority code and regression tests; not the current production runtime.
- `docs/` — migration authority, manifests, policy, and supporting technical documentation.
- `Dockerfile` — production image definition.
- `compose.yaml` — production residency, mounts, security options, and required runtime configuration.

## Runtime configuration

The Compose runtime requires the following configuration classes. Do not commit secret values.

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
DEBUG_AI_GROQ_URL      # optional override
DEBUG_AI_GEMINI_URL    # optional override
```

At least one configured external reviewer is required by the server bootstrap.

## Container security / residency

Production is defined by Docker Compose and currently uses:

- host networking;
- loopback application bind (`127.0.0.1:8787`);
- `no-new-privileges:true`;
- all Linux capabilities dropped;
- runtime state on a named volume;
- workspace mounted read/write only where patch operations require it;
- OSV DB, debugging tools, and Evidence Search credential mounted read-only.

Do not bypass the Compose/runtime contract with ad-hoc host execution for production.

## Development and verification

Required Node.js runtime:

```text
24.20.0
```

Install dependencies and run the current server verification:

```bash
npm install
npm run verify
```

`npm run verify` performs syntax checks and the active server/orchestrator test suites.

Legacy PC authority regression tests are separate:

```bash
npm run test:legacy
```

Run the production server locally only with all required environment values available:

```bash
npm start
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

- **AI Core is a separate service.** DebugAI consumes it through the API and does not rewrite AI Core internals.
- **External AI cannot apply code.** External providers review hypotheses/final results only.
- **Patch Engineer cannot apply code.** It creates a candidate only.
- **Patch application requires explicit approval.** A generated candidate is not authorization to write.
- **Evidence Search is authoritative only when its result is final-valid.** Rejected/insufficient evidence is carried as uncertainty.
- **TGserver is API-only.** Direct Telegram/Redis/Meilisearch access is outside the DebugAI runtime contract.
- **Secrets must never be emitted to logs or committed to this repository.**
- **Repository writes must stay inside the workspace/allowlist boundary.**

## Runtime validation status

As of 2026-09-26, real Contabo validation has demonstrated:

- AI Core authenticated access through the single API entrypoint;
- Code Scout and Causal Scout execution;
- Researcher execution with thinking disabled;
- Diagnoser execution with thinking enabled and a measured role-specific timeout budget;
- Evidence Search signed API reach plus explicit evidence-gap handling;
- TGserver runtime logging and knowledge search/promotion adapter paths;
- Groq and Gemini external-review reach;
- external-review verdict normalization (`PASS|FAIL|PENDING`);
- `/v1/analyze` reaching both internal diagnosis and external hypothesis review;
- Docker build/recreate/health on the Contabo runtime.

The full real closed-loop acceptance gate — Patch Candidate -> Master Approval -> Apply -> Retest -> Local Review -> External Final Review -> COMPLETE — must be proven by real E2E before the project is called complete. This README intentionally does not claim that final gate prematurely.

## Non-goals

DebugAI is not:

- an unrestricted autonomous code writer;
- a replacement for AI Core routing/model residency;
- a direct TGserver storage client;
- a direct Evidence Search implementation;
- a mechanism for bypassing explicit patch approval;
- a reason to treat weak or missing evidence as authoritative fact.

Its job is to make debugging faster **without removing evidence, verification, repository, approval, and security boundaries**.
