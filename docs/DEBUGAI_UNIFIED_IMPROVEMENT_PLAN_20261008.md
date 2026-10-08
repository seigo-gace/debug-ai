# DebugAI Unified Improvement Plan — 2026-10-08

Status: ADOPTED DESIGN AUTHORITY / IMPLEMENTATION MAY PROCEED UNDER CURRENT GITHUB PROJECT RULES  
Target repository: `seigo-gace/debug-ai`  
Target branch: `feat/tgserver-async-log-sink-20261003`

## 1. Purpose

Improve DebugAI as one integrated debugging system, not as separate "investigation" and "code generation" products.

The improvement must preserve the current architecture and add only what is missing or insufficient. Existing RunAuthority, six-role workflow, Evidence Registry, Active Evidence Window, Context Compression, Tool Loop, Progress Controller, RuntimeEvidence, Sandbox verification, Local Reviewer, External Review, Strict Completion, approval boundaries, Server Command / Guarded GitOps safety controls, and durable continuation remain authoritative unless Fresh Current evidence proves a specific defect.

The target is to improve both:

1. the AI control plane — role contracts, model-specific invocation, context selection, skill routing, output contracts, evidence handoff, reasoning/output budgets;
2. the execution plane — queueing, timeout accounting, telemetry, tools, sandbox preflight, deterministic verification, repair loop, persistence and scheduling.

Do not maximize feature count. Reuse existing implementation and verified assets. Add a new tool, skill or subsystem only where a verified gap remains.

## 2. Evidence baseline

### Investigation / verification 50-case baseline

Historical benchmark run: `37608576657`.

- DONE: 21/50
- AI_CORE_TIMEOUT: 18/50
- FORMAT_CONTRACT: 9/50
- AI_CORE_BUDGET_EXHAUSTED: 1/50
- AI_CORE_HTTP: 1/50
- semantic grade of DONE: PASS 14 / PARTIAL 5 / FAIL 2
- successful-output latency: mean about 296.2s, median about 232.3s, P90 about 545.1s, P95 about 571.4s
- mean queue wait about 177.1s
- mean upstream model wall about 119.0s

Historical qualification: the first Code Scout benchmark contract did not match production semantics, so its 0/10 completion result must not be treated as a clean model-capability measurement.

### Code generation 60-case baseline

- Semantic PASS: 25/60 = 41.7%
- Semantic MISS: 26/60 = 43.3%
- Format/Contract Failure: 9/60 = 15.0%
- additional 50 candidate generation success: 42/50
- scope failure: 0
- apply/deploy incident: 0
- successful candidate generation mean latency: about 174.7s

Repeated semantic miss families include:
- Python bool/int confusion;
- ASCII versus Unicode predicate mistakes;
- conversion-order errors;
- unhashable/equality assumptions;
- input mutation;
- boundary/empty/zero cases;
- syntax or undefined-name failures.

## 3. Current model assignments

- Code Scout: Qwen2.5-Coder-7B-Instruct Q4_K_M
- Causal Scout: Qwen3-8B Q4_K_M, non-thinking
- Researcher: Granite-4.2-8B Q4_K_M, non-thinking
- Diagnoser: Qwen3-8B Q4_K_M, thinking
- Patch Engineer: Qwen2.5-Coder-7B-Instruct Q4_K_M
- Local Reviewer: Ministral-3-8B-Reasoning-2512 Q4_K_M

Do not replace the models first. Separate DebugAI-side defects from model capability before model replacement is considered.

## 4. Non-negotiable invariants

- GitHub Project Current is the operating control plane.
- Fresh repository / branch / HEAD / PR / CI evidence overrides stale chat or history.
- Keep SOURCE / CI / RUNTIME / MERGE / DEPLOY states separate.
- Candidate generation never implies apply, merge or deploy.
- Existing approval, exact-SHA, scope and protected-operation gates remain fail-closed.
- Never use model self-claims as verification proof.
- A valid JSON shape is not proof of semantic correctness.
- A green test by itself is not proof of complete requested behavior.
- Retrieved reusable code is not trusted until target-repository verification.
- `Verified(A) + Verified(B) != Verified(A+B)`.
- Do not create duplicate orchestration, review, sandbox, evidence or completion systems.

## 5. Unified target architecture

```text
Request / failure / target repository
  -> deterministic + role-aware intake
  -> Requirement / Evidence Contract
  -> repository scope / symbol / dependency / contract context selection
  -> Code Scout / Causal Scout / Researcher / Diagnoser as required
  -> evidence-bound diagnosis
  -> Patch Packet with immutable requirement + evidence handoff
  -> Patch Engineer candidate
  -> deterministic candidate preflight
  -> sandbox compile/type/lint/test verification
  -> semantic diff / required-edit closure / test-strength checks
  -> bounded repair using only fresh failure evidence
  -> fresh-context Local Reviewer
  -> existing External Final Review when required
  -> existing Strict Completion
  -> existing approval / guarded execution boundaries
```

Investigation and code generation share the same execution/control foundation. Role-specific behavior remains separate.

## 6. Improvement priorities

### P0-A — Contract correctness

Reuse the existing invocation compiler and semantic validator.

Required:
- production prompt, validator and benchmark schema must describe the same contract;
- Code Scout, Diagnoser and Patch Engineer output contracts must have one canonical field definition;
- preserve Causal Scout's strong baseline contract;
- preserve Researcher's evidence/version fields;
- preserve Local Reviewer as the fresh final local reviewer;
- semantic validation must distinguish shape validity, evidence-binding validity and task-semantic correctness.

Do not create a second schema engine.

### P0-B — Runtime timing and telemetry

Reuse the existing AI Core and role runtime telemetry.

Required:
- queue wait budget, model execution budget and total workflow wall budget are separate concepts;
- queue timeout is classified separately from model timeout;
- queue wait, prepare, upstream wall, parse/validate, prompt-eval, decode, cache, token and tool timing are durably recoverable per role/run;
- do not remove the current global serialization until bounded concurrency is measured.

### P0-C — Model-specific qualification

Use the existing model A/B benchmark and change one axis at a time.

Priority:
1. Diagnoser Qwen3 thinking configuration;
2. Researcher Granite sampling;
3. Local Reviewer Ministral reasoning/final-content compatibility;
4. Code Scout Qwen2.5-Coder after contract parity;
5. Patch Engineer Qwen2.5-Coder after deterministic preflight is connected.

Causal Scout is a regression control and must not be changed without evidence.

Official sampling values are experiment candidates, not automatic production values.

### P1-A — Requirement / Evidence Contract handoff

The handoff from investigation to Patch Engineer must retain:
- requested behavior;
- forbidden changes;
- preserved behavior;
- exact source / revision identity;
- selected files / symbols / dependency facts;
- evidence IDs and unresolved UNKNOWNs;
- acceptance conditions;
- required tests / regressions;
- language-specific constraints when applicable.

Prefer extending existing Patch Packet / runtime packet providers over adding a new model-callable tool.

### P1-B — Candidate deterministic preflight

Before a Patch Candidate can be considered verification-ready:
- validate operation structure and selected-path scope;
- materialize candidate only inside the existing isolated verification workspace;
- run language-appropriate syntax/static checks;
- detect deterministic contract traps where safely possible;
- run targeted executable checks where the requirement can be deterministically represented.

The AI does not decide whether preflight runs. Workflow controls this gate.

### P1-C — Bounded evidence-driven repair

Reuse the existing bounded automatic re-fix mechanism.

A retry must receive:
- exact failed check;
- exact changed source identity;
- smallest relevant error/output;
- prior candidate identity;
- unchanged scope boundary.

Maximum repair attempts remain bounded. Repeating the same unsupported failure without new evidence escalates instead of looping.

### P1-D — Minimal new skills

Add only if implementation audit confirms the gap:

- `spec-contract-audit`
  - shared by investigation/diagnosis/patch planning when a natural-language contract contains material constraints;
  - converts explicit constraints into checkable obligations;
  - does not replace deterministic validation.

- `python-edge-semantics`
  - Patch Engineer / reviewer helper only for Python tasks;
  - covers bool/int, ASCII/Unicode, hashability/equality, mutation and boundary traps observed in the 60-case corpus;
  - never loaded for non-Python tasks.

Do not add `candidate-self-check` as a primary proof skill. Model self-review may be advisory only.

### P2-A — Fast / Deep execution modes

Only after P0/P1 measurements.

Fast Lane candidate:
- low-risk, single-responsibility, bounded-context task;
- direct role invocation + deterministic preflight + at most one evidence-driven repair.

Deep Lane:
- multi-file/dependency/architecture/uncertain-evidence cases;
- full tool/evidence loop.

Routing must be deterministic/risk-aware first, not model-confidence-only.

### P2-B — Scheduling

Only after queue versus execution telemetry is qualified.

Compare:
- concurrency 1 baseline;
- bounded model-aware concurrency 2.

If beneficial, replace the one global queue with a bounded model-aware semaphore/scheduler. Never use unbounded concurrency.

### P3 — Reuse and advanced code-generation assets

Retain the existing 5V-RCCA and codegen reliability designs.

ModuleCatalog / G-ACE KB are reuse candidate sources, not automatic trust authorities.

Potential reusable capabilities include:
- context-aware contract codegen;
- compile-feedback repair;
- semantic diff review;
- regression-test generation;
- targeted regression selection;
- false-pass detection.

Prefer thin adapters and target-specific verification over reimplementation.

## 7. Tool policy

Preserve and improve existing read-only tools:
- source.read
- source.search
- symbol.lookup
- dependency.map
- test.inventory
- evidence.read
- knowledge.search
- authority.search
- existing bounded server read surfaces

Do not expose a large new toolbox to models.

Candidate preflight, semantic-diff gating and mandatory verification should normally be workflow-owned deterministic stages rather than optional model tool calls.

## 8. Validation strategy

Do not judge improvement from CI alone.

Use four evidence layers:

1. source/unit/integration tests;
2. fixed historical regression corpora:
   - investigation 50-case baseline;
   - code generation 60-case baseline;
3. new holdout cases not used to design the fix;
4. real repository dogfood: investigation -> diagnosis -> candidate -> sandbox -> failed-check re-fix -> regression -> review -> Strict Completion.

Track by role and whole workflow:
- completion rate;
- semantic PASS / PARTIAL / FAIL;
- format/contract failure;
- timeout class;
- queue wait;
- prompt-eval/decode/upstream wall;
- token usage;
- selected skills/tools;
- retry/recovery rate;
- repeated failure fingerprint;
- scope failure;
- apply/deploy incident.

## 9. Rollout order

### Phase 0 — Fresh implementation audit
Map this design to Fresh HEAD and classify every item:
- EXISTS / KEEP
- EXISTS / IMPROVE
- NEW INTEGRATION REQUIRED
- DEFER
- REJECT

Do not reimplement EXISTS items.

### Phase 1 — Shared control-plane/runtime corrections
- contract parity;
- timeout accounting;
- telemetry persistence/readback;
- model A/B qualification hooks.

### Phase 2 — Investigation/verification stabilization
- re-run corrected 50-case benchmark;
- repair remaining Code Scout / Diagnoser / Reviewer issues;
- preserve Causal Scout control;
- confirm UNKNOWN / INSUFFICIENT_EVIDENCE calibration.

### Phase 3 — Code generation reliability
- Requirement/Evidence Contract handoff;
- candidate deterministic preflight;
- sandbox verification;
- semantic diff/test-strength gates;
- bounded evidence-driven repair.

### Phase 4 — Performance optimization
- Fast/Deep A/B;
- normal role output ceilings;
- model-aware queue concurrency test;
- prompt/context reduction only where measurements justify it.

### Phase 5 — Real dogfood / Strict Completion
Prove the full real-repository loop without weakening existing approval/security boundaries.

## 10. Explicitly rejected / deferred approaches

Do not:
- replace Qwen2.5-Coder-7B before DebugAI-side qualification;
- rebuild the six-role architecture;
- add duplicate reviewer/orchestrator/sandbox/evidence systems;
- trust AST/static checks as complete semantic proof;
- apply one sampling configuration to every model/role;
- remove the global queue without resource evidence;
- increase tool-loop rounds/calls just to "reason more";
- make self-review a completion gate;
- optimize only for the 50/60 historical questions;
- claim target accuracy or latency improvement before runtime evidence.

## 11. Existing design authorities preserved

This document integrates and extends; it does not invalidate the useful content of:

- `docs/INVESTIGATION_VERIFICATION_IMPROVEMENT_MASTER.md`
- `docs/CODEGEN_RELIABILITY_DESIGN_DELTA.md`
- `docs/CODEGEN_5V_RCCA_FOUNDATION.md`
- `docs/CODEGEN_SANDBOX_SNAPSHOT_DESIGN_DELTA.md`
- existing durable continuation / role / evidence / safety design authorities

Where an older document says code-generation semantic work is DEFERRED only because investigation was temporarily prioritized, this unified plan supersedes that temporary sequencing decision. Existing safety and responsibility boundaries remain in force.

## 12. Completion rule

This plan is complete only when Fresh Current evidence proves:
- the relevant implementation is connected, not merely designed;
- exact-head CI passes;
- fixed baselines and holdout tests show no material regression;
- real runtime/dogfood evidence demonstrates the intended behavior;
- source/runtime identity is bound to the evidence;
- scope and protected-operation incidents remain zero;
- Strict Completion is supported by evidence rather than model claims.
