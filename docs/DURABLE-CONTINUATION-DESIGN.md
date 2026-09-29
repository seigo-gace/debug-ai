# DebugAI Architecture and Durable Continuation Design Authority

Status: **ACTIVE DESIGN AUTHORITY — CURRENT IMPLEMENTATION ALIGNED**

Repository: `seigo-gace/debug-ai`

Branch: `feat/durable-role-continuation-final-20260928`

Implementation snapshot reviewed for this revision: `926dda4d17d739452b06e07f23ea5de8a5b8b800`

Base main snapshot: `9171102bee023e57e84f1f933b4405137e891a6d`

PR: `#21` (`OPEN / DRAFT / UNMERGED` at the reviewed implementation snapshot)

Purpose: define the complete DebugAI execution architecture, durable-continuation model, AI-side control plane, evidence model, approval/review boundaries, storage/retention policy, completion contract, verification gates, and current implementation boundary without silently treating pending wiring as complete.

> Documentation completeness is not implementation completeness. This document describes both implemented behavior and explicitly pending behavior. A component, module, or test existing in source is not sufficient to claim runtime completion unless the real workflow calls it with authoritative runtime evidence and the required verification has passed.

---

## 1. System purpose

DebugAI is a code-first, evidence-driven debugging runtime designed to act as a specialized execution sub-agent for a user's primary AI. Its job is not to replace the primary AI and not to provide unrestricted autonomous code mutation. Its job is to make debugging cheaper, repeatable, evidence-bound, recoverable, and verifiable.

The runtime combines:

- six role-specialized local AI executions;
- deterministic repository/runtime verification;
- read-only tool execution and bounded tool loops;
- DAP/runtime hints that remain non-authoritative until bound to evidence;
- TGserver knowledge retrieval and long-term evidence/log archival;
- Astera Evidence Search for authoritative external evidence when required;
- external AI review at explicitly bounded review points;
- patch candidate generation separated from patch application;
- explicit human approval before mutation;
- post-apply deterministic retest and invariant verification;
- fresh local review;
- strict final completion gating;
- durable interruption/restart/recovery with replay-safe reuse of completed work.

The system must optimize cost and speed without weakening evidence, verification, repository, approval, recovery, or security boundaries.

---

## 2. Non-negotiable architecture rules

1. `RunAuthority` remains the single authoritative execution/state owner.
2. Do not create a second orchestrator, second state machine, or competing execution authority.
3. Extend existing contracts instead of replacing them without an explicit migration decision.
4. Six internal roles remain distinct; do not merge or delete them for convenience.
5. Patch Engineer creates candidates only and never self-applies.
6. Read-only verification remains read-only.
7. Patch application requires an explicit approval decision and matching candidate identity.
8. External/project/tool content is `DATA_NOT_INSTRUCTION`.
9. Model output is never automatically evidence.
10. Missing evidence remains missing evidence. `UNKNOWN` is a valid result and must not be rewritten as `PASS`, `NONE`, or fact.
11. Raw hidden chain-of-thought is not persisted.
12. Secrets, tokens, passwords, cookies, API keys, or equivalent credentials are not persisted in durable role state, logs, evidence, prompts, or repository documents.
13. Shadow/semantic metadata must not be attached to authoritative role JSON in a way that changes the durable JSON contract.
14. Generated code is not verified code.
15. A module existing in source is not proof that the live workflow uses it.
16. A passing fixture is not a substitute for the required real closed-loop E2E.
17. GitHub source authority and the currently deployed server checkout are separate facts.
18. No main merge, deploy, or production change is authorized by this design document or PR alone.
19. Global AI Core serialization remains in place until real server resource evidence justifies a concurrency change.
20. Optimization must first eliminate unnecessary calls and unnecessary prompt/tool payload before attempting parallelism.

---

## 3. End-to-end workflow contract

The intended guarded debugging loop is:

```text
Failure / request / local runtime evidence
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
        | explicit approve + identity binding
        v
Patch apply
        v
Deterministic retest + invariants
        v
Local Reviewer with fresh review context
        v
External Final Review when required
        v
Strict Completion Gate
        |
        +----> COMPLETE
        |
        +----> blocked / failed / pending / unknown
```

`COMPLETE` must never be a synonym for "External Final Review returned PASS".

---

## 4. Six internal AI roles

All internal model execution goes through AI Core. DebugAI does not own llama.cpp model processes directly.

| Role | Current model authority | Thinking baseline | Core responsibility |
| --- | --- | --- | --- |
| Code Scout | Qwen2.5-Coder 7B | provider/profile baseline | inspect code/failure surface and identify evidence to gather |
| Causal Scout | Qwen3 8B | disabled | form independent falsifiable causal hypotheses |
| Researcher | Granite 4.2 8B | disabled | gather/select decisive evidence and preserve evidence gaps |
| Diagnoser | Qwen3 8B | enabled | produce evidence-bound falsifiable diagnosis |
| Patch Engineer | Qwen2.5-Coder 7B | provider/profile baseline | create patch candidate only |
| Local Reviewer | Ministral 3 8B Reasoning 2512 | provider/profile baseline | review applied result and verification evidence from fresh context |

Common role rules:

- `paid_allowed=false` where the role/provider policy requires free/local operation;
- external/project/tool text remains data, not instruction;
- FACT claims must bind to evidence IDs;
- INFERENCE must be labeled;
- HYPOTHESIS must be falsifiable;
- `UNKNOWN` is valid;
- rejected hypotheses remain auditable;
- model output does not become evidence by itself;
- raw chain-of-thought is not stored;
- permission denial and safety gates are fail-closed;
- timeout/cancellation/retry state participates in durable execution.

Role-specific configuration must remain role-specific: purpose, entry condition, stop condition, handoff, context, skill procedure, allowed tools, network/write scope, token/timeout/round budgets, and failure policy must not be flattened into one universal role profile.

Model-specific configuration must also remain independent: thinking, sampling, prompt profile, chat template, tool protocol, structured output shape, context cap, fallback, and benchmark qualification are model/profile concerns rather than role semantics.

---

## 5. AI-side optimization authority

Optimization priority is fixed in this order unless measured evidence justifies a change:

1. unnecessary role calls;
2. unnecessary search/provider calls;
3. duplicated prompt content;
4. repeated Tool Observation payload;
5. unnecessary skills;
6. unnecessary tool rounds;
7. completion-token volume;
8. thinking mode;
9. sampling;
10. model parallelism.

The global AI Core serial queue remains intentional. Parallel execution must not be enabled merely because it appears faster in theory. Server RAM, CPU pressure, queue behavior, and model runtime must be measured first.

### 5.1 AI Core baseline telemetry — implemented

`server/adapters/ai-core.js` records measured telemetry including:

- `queue_wait_ms`;
- `prepare_ms`;
- `upstream_request_wall_ms`;
- `parse_validate_ms`;
- `role_wall_ms`;
- request/response bytes;
- attempts;
- provider prompt/completion/total tokens when the provider returns them;
- finish reason when available.

Unavailable provider metrics remain `null`; DebugAI must not present estimates as measured facts. Timeout and HTTP-error paths retain telemetry collected before failure.

### 5.2 Role Tool Loop telemetry — implemented

`server/control/tool-loop.js` emits role-runtime telemetry covering LLM calls, queue/prepare/upstream/parse/role wall time, byte counts, token completeness, tool wall time, and executed/reused tool calls.

Do not create a duplicate telemetry plane for the same responsibility.

---

## 6. Skill, tool, and semantic control plane

The control plane distinguishes at least these responsibilities:

- role contract;
- model profile;
- invocation compilation;
- skill registry/procedures;
- read-only tool runtime;
- tool risk;
- progress/no-progress control;
- claim/evidence binding;
- role output validation;
- role disposition / shadow skip logic;
- runtime packets;
- repository revision gating;
- capability gap audit.

### 6.1 Production skill isolation — implemented

Production skill procedures must not contain benchmark fixture answers, fixed runtime versions, hard-coded benchmark paths, or model answers designed only to satisfy tests. Benchmark-specific knowledge belongs in benchmark/test code.

### 6.2 Capability gaps — still open

The gap audit currently retains 11 capabilities as `NOT_IMPLEMENTED`, classified by responsibility such as `MODEL_TOOL`, `RUNTIME_PACKET`, or `DETERMINISTIC_CORE`.

Classification is not implementation. Do not convert all gaps mechanically into Model Tools. Each gap must be closed by the responsibility that actually owns the capability.

### 6.3 Role/Search gates — shadow partial

Role-disposition/search-gate components exist, but broad production skip activation is not complete. Shadow decisions must be compared with real outcomes first, with false-skip risk treated as a blocking safety issue. Search necessity should be gated before invoking TGserver/official search when the evidence need can be decided safely.

---

## 7. Evidence model

Evidence is an explicit runtime object, not free-form model confidence.

Core rules:

- local deterministic evidence, tool evidence, TGserver evidence, and authoritative external evidence remain distinguishable;
- DAP data can guide investigation but is `HINT_ONLY` until converted into registered evidence through an allowed path;
- evidence IDs bind claims to concrete evidence records;
- evidence integrity is validated before reuse;
- tool errors do not become supporting evidence;
- missing authoritative evidence results in an evidence gap rather than fabricated support.

### 7.1 Astera Evidence Search

Evidence Search is accessed only through its internal API and configured internal-service authentication. Its adapter enforces the expected result contract, free-only policy, `ai_used === false`, `payment_executed === false`, and the required final-valid state.

A non-final result such as `REJECTED_INITIAL_QUALITY` remains an evidence gap and cannot be promoted to authoritative evidence.

### 7.2 TGserver

TGserver is accessed through HTTP APIs rather than direct Telegram/Redis/Meilisearch access. Runtime-log archival and knowledge-base retrieval/promotion remain separate responsibilities.

---

## 8. Evidence Projection and Active Evidence Window

This optimization is **implemented and connected to the Tool Loop**.

Before this connection, historical Tool Observations could be serialized repeatedly into subsequent model calls. Large read results could therefore multiply prompt size and prefill cost.

The current rule is:

- original observations are preserved;
- durable evidence is preserved;
- continuation state is preserved;
- only the prompt view is bounded.

Current prompt-view limits:

```text
max chars per projected evidence = 2400
max active evidence items        = 12
max projected evidence chars     = 12000
```

Tool errors remain bounded `DATA_ONLY` summaries and must not be upgraded to evidence.

This layer is a projection/view optimization, not evidence deletion or retention policy.

---

## 9. Durable continuation architecture

Durable continuation has two layers that must both work: runtime recovery and AI-side continuation.

### 9.1 Runtime execution layer

The runtime must durably:

- record authoritative state;
- reject stale writers;
- preserve `run_id`, `role_execution_id`, attempt, generation, and execution epoch;
- survive process termination/restart;
- restore checkpoints/results;
- restore the correct workflow cursor;
- preserve retry/timeout/cancellation/budget/no-progress state;
- expose recoverable state through status/inspection interfaces.

### 9.2 AI execution layer

Roles must:

- know which work units are complete;
- reuse committed deterministic/read-only effects when identity and freshness still match;
- avoid repeating completed reads/searches/effects;
- continue from the next unfinished work unit;
- persist explicit structured progress without hidden reasoning;
- commit durable `RoleResult` objects;
- allow downstream roles to consume saved upstream results without rerunning completed upstream work.

---

## 10. Durable storage and execution identity

Authoritative durable state uses one writer authority and one commit protocol.

Distinct identities:

```text
run_id
role_execution_id
attempt
generation
execution_epoch
```

A continuation of the same logical role retains `role_execution_id` and creates a new attempt when required.

### 10.1 Writer/commit safety — implemented

The branch contains:

- durable canonical primitives/envelopes;
- `DurableFileIO`;
- native Linux writer lock;
- generation monotonicity;
- execution-epoch fencing;
- stale generation/epoch rejection;
- durable run-state and execution manifest;
- authoritative commit protocol.

### 10.2 RoleCheckpoint — implemented

RoleCheckpoint stores explicit resumable state such as role identity, attempt, cursor/progress, work-unit state, evidence/effect references, retry/cancellation/progress metadata, and integrity metadata. It must not store hidden model reasoning.

### 10.3 RoleResult — implemented

RoleResult is a durable role-level result separate from the overall run result. It can be consumed downstream without rerunning the producing role, but it cannot claim whole-run completion.

### 10.4 Effect Ledger — implemented

The Effect Ledger assigns stable logical identity to committed reusable effects. Reuse is allowed only when the input binding, repository snapshot/revision requirements, tool contract/environment, referenced result, digest, and freshness/reference policy still match. Mutation-capable operations do not gain autonomous replay authority.

### 10.5 Work Unit Registry — implemented

Researcher continuation uses explicit A/B/C/D/E work units. A/B/C gather evidence, D reconciles contradictions after dependencies, and E assembles final evidence selection. The registry integrates with the existing Tool Loop/ProgressController rather than creating a second orchestrator.

---

## 11. Real interruption/restart acceptance

The required durable behavior is:

```text
A commits
B commits
C starts
C is interrupted
process is killed/restarted
same run_id is restored
same role_execution_id is restored
new continuation attempt is created
A is reused and NOT rerun
B is reused and NOT rerun
C continues
RoleResult is committed
Diagnoser consumes the restored Researcher result
```

At the reviewed implementation snapshot, real SIGKILL restart regression coverage has been restored and is passing in repository verification. A previously discovered regression was caused by semantic-shadow metadata being attached as a non-enumerable own property to authoritative role output. Standard JSON serialization hid it, while durable canonical JSON correctly rejected it. The fix moved semantic shadow state outside authoritative role JSON via WeakMap and added canonical-JSON regression coverage.

Required rule:

> Shadow/audit metadata must not mutate the durable role-output object contract.

Durable continuation, retention, sandbox boundaries, restart acceptance, terminal GC safety, writer locking, generation/epoch fencing, and replay-safe tool effects are established areas and should not be reimplemented during later AI-side optimization.

---

## 12. Storage, retention, archive, and GC authority

### 12.1 Authority split

- TGserver is the long-term log/evidence archive authority for archived terminal-run summaries and long-lived log/evidence material.
- DebugAI local server storage holds authoritative durable continuation state and bounded operational cache.
- Local storage is not the long-term log warehouse.

### 12.2 Runtime Evidence cache

Target policy:

```text
retention window     = 12 hours
local byte ceiling   = 32 MiB
rotation cadence     = 15 minutes + startup
```

Age and capacity limits both apply. Active/recoverable durable state is not removed by this cache policy.

### 12.3 Sandbox jobs

Completed sandbox source snapshots/work directories should be removed as soon as terminal results are safely consumed and required result/evidence is persisted. Orphan cleanup must prove a job is not active before deletion.

### 12.4 Durable run bundle deletion

Recoverable runs are not age-deleted. Durable run state, manifest, RoleCheckpoint, RoleResult, Effect Ledger, and workflow data are treated as one validated bundle for deletion safety.

A terminal run becomes a GC candidate only after required archive/receipt acceptance. Missing or ambiguous archive confirmation blocks durable deletion. A post-archive safety window is preserved.

### 12.5 Patch retention

Default safety targets:

- unapproved patch candidates: 7 days;
- applied backup with verification PASS: 72 hours;
- applied backup with verification FAIL/incomplete: 7 days.

Rollback and approval safety outrank cleanup aggressiveness.

### 12.6 Docker/disposable resources

Docker stdout/stderr is bounded operational output, not the long-term log authority. Broad automatic `docker system prune -a --volumes` behavior is forbidden. Active named volumes are not automatically removed.

---

## 13. Repository revision authority

Repository revision binding is part of correctness, not metadata decoration.

Rules:

- a patch candidate is bound to repository state;
- approval/apply must validate candidate identity and hash;
- post-apply repository revision/snapshot must be captured;
- final review/completion must bind to the current revision rather than a stale pre-review state;
- restart/resume must reject incompatible repository snapshots when required by the durable contract.

The existing repository snapshot/revision machinery must be reused; do not introduce an unrelated second revision system.

---

## 14. Patch and review packet boundaries

Runtime packet components exist, but full Patch Engineer / Local Reviewer packet wiring is still a pending workstream.

Required direction:

- Patch Engineer receives candidate-generation context only and never apply authority;
- patch packet contains the minimum authoritative evidence/diagnosis/revision context required to produce a candidate;
- Local Reviewer runs from fresh review context and does not treat producer reasoning as authority;
- review packet binds applied candidate, revision, deterministic verification, invariants, and required evidence;
- do not add a second large autonomous Tool Loop to Patch Engineer or Local Reviewer merely to compensate for missing packet design.

---

## 15. Strict Completion Gate

### 15.1 Completion is a conjunction

A DebugAI run may become `COMPLETE` only when all required conditions are true from runtime evidence:

```text
candidate identity valid
AND approval receipt valid
AND apply receipt valid
AND current repository revision bound
AND required verification actually executed
AND deterministic verification PASS
AND invariants PASS
AND Local Reviewer PASS
AND required External Final Review PASS
AND no blocking evidence gap
AND final run contract valid
```

Missing mandatory evidence must fail closed.

### 15.2 Completion Gate module/input — implemented

`server/control/completion-gate.js` defines the required conjunction and provides runtime-input construction/evaluation. The current implementation explicitly blocks cases including:

- missing analysis evidence-gap record;
- missing repository revision evidence;
- repository revision mismatch;
- verification not executed;
- deterministic verification failure;
- invariant failure;
- reviewer non-PASS/UNKNOWN;
- external final non-PASS when required;
- candidate/receipt mismatch.

Focused regression coverage exists for the gate and runtime input builder.

### 15.3 Workflow wiring — pending and highest priority

At the reviewed implementation snapshot, `server/workflow.js` still reaches final completion through an older path centered on final-review PASS. Therefore:

> Strict Completion is **not complete** until `approveAndVerify()` constructs the gate input from actual runtime evidence, evaluates/asserts the gate, and only then transitions to `COMPLETE`.

The wiring must use actual values, not guessed booleans:

- candidate ID/hash from the selected candidate and application receipt;
- explicit approval decision;
- patch application receipt;
- post-apply repository snapshot and final-review/current snapshot comparison;
- executed deterministic checks and gates;
- invariant results;
- fresh local-review verdict;
- required external-final verdict;
- latest authoritative analysis evidence record for `evidence_gap`;
- real final-contract validation.

The current input builder's `run_final_contract_valid` derivation is not by itself sufficient proof of a fully validated final contract. Workflow wiring must not turn this field true unless the runtime's actual final-contract condition is proven.

---

## 16. External review boundaries

External AI is restricted to review boundaries rather than owning the debugging loop.

1. Hypothesis Review — after diagnosis and before patch generation.
2. Final Review — after apply/retest/local review when required by policy.

Normalized decision contract:

```text
PASS | FAIL | PENDING
```

Unknown provider decision shapes fail closed. External review cannot apply code, bypass Master approval, override deterministic verification, or substitute for missing evidence.

---

## 17. HTTP API and CLI direction

Current runtime includes routes for health/status/inspection, analysis, patch candidate generation, read-only verification, explicit approve/apply/verify, and knowledge promotion.

Durable execution direction requires client lifetime to be separable from logical run lifetime. Start/status/inspect/resume semantics must preserve:

- stable run identity;
- idempotence where defined;
- durable cursor recovery;
- approval boundary;
- repository safety;
- machine-readable CLI output;
- no CLI patch-apply shortcut.

Do not describe an API behavior as complete merely because durable state exists underneath it.

---

## 18. Model A/B authority

Current measured generation profile recorded for the active server/model setup:

```text
Qwen2.5-Coder 7B   14.66 tok/s
Qwen3 8B            4.18 tok/s
Granite 4.2 8B      5.82 tok/s
Ministral 3 8B      7.98 tok/s
```

Current sampling baseline is `temperature=0`.

Model optimization remains pending. A/B procedure must use the exact GGUF and current llama.cpp/llama-swap environment and vary one dimension at a time:

1. thinking mode;
2. sampling;
3. token cap.

Official recommended settings are reference information, not automatic production settings. Unmeasured values must not be reported as PASS.

Qwen Coder parallel-use/environment experimentation is separate and currently on hold; it must not block core DebugAI work.

---

## 19. Verification authority

Repository runtime requires Node.js `24.20.0`.

Primary repository verification:

```bash
npm install
npm run verify
```

`npm run verify` builds the durable native component, runs syntax checks, and runs the repository/server tests.

Additional explicit gates include deterministic fixture E2E, legacy authority tests, control-plane gap audit, benchmarks, storage audit, public readiness, Core Verify, and CodeQL as applicable.

### 19.1 Current verified implementation snapshot

At implementation snapshot `926dda4d17d739452b06e07f23ea5de8a5b8b800`:

```text
Verify                 = SUCCESS
Core Verify            = SUCCESS
Public Readiness Audit = SUCCESS
CodeQL                  = SUCCESS
```

This CI evidence belongs to that exact implementation SHA. Documentation-only commits after that SHA require their own new CI readback and must not inherit the old SHA's CI status automatically.

### 19.2 Required real closed-loop E2E — still pending

Final DebugAI completion still requires a real full closed-loop test covering, at minimum:

- unknown fixture/unknown failure handling;
- real repository defect;
- prompt-injection resistance;
- stale repository revision rejection;
- evidence insufficiency path;
- SIGKILL resume;
- patch candidate;
- explicit approval boundary;
- deterministic retest;
- fresh local review;
- required external final review;
- strict completion gate.

A fixture-only path does not satisfy this final gate.

---

## 20. Current implementation status matrix

Implementation snapshot: `926dda4d17d739452b06e07f23ea5de8a5b8b800`.

| Area | Status | Notes |
| --- | --- | --- |
| Durable primitives / writer lock / commit fencing | IMPLEMENTED + VERIFIED | do not rebuild |
| RoleCheckpoint / RoleResult | IMPLEMENTED + VERIFIED | durable role boundary established |
| Effect Ledger / replay-safe reuse | IMPLEMENTED + VERIFIED | reuse remains identity/freshness bound |
| Researcher A/B/C/D/E continuation | IMPLEMENTED + VERIFIED | restart acceptance restored |
| Real SIGKILL restart regression | VERIFIED PASS | semantic-shadow durable regression fixed |
| Runtime Evidence retention/security | IMPLEMENTED + VERIFIED | bounded local cache policy |
| Durable archive / terminal GC safety | IMPLEMENTED + VERIFIED boundary | archive receipt required before eligible deletion |
| AI Core baseline telemetry | IMPLEMENTED | measured/null semantics required |
| Role Tool Loop telemetry | IMPLEMENTED | includes executed/reused tool work |
| Production skill/benchmark isolation | IMPLEMENTED | benchmark leakage removed |
| Evidence Projection + Active Evidence Window | IMPLEMENTED + TOOL LOOP CONNECTED | prompt view only; original evidence preserved |
| Strict Completion Gate module | IMPLEMENTED | 11-condition AND gate |
| Strict Completion runtime-input builder | IMPLEMENTED + TESTED | missing mandatory evidence fail-closed |
| Strict Completion workflow wiring | **PENDING** | highest-priority next implementation |
| Patch / Review Packet workflow wiring | PENDING | reuse existing runtime-packet components |
| Role/Search Gate | SHADOW PARTIAL | validate false-skip risk before activation |
| Capability gaps | 11 NOT_IMPLEMENTED | close by responsibility |
| Model A/B | PENDING | exact environment, one variable at a time |
| Real full closed-loop E2E | PENDING | required before final completion claim |
| Main merge | NOT AUTHORIZED / NOT DONE | PR remains draft/unmerged at snapshot |
| Deploy / production change | NOT DONE | source authority remains separate from live server |

---

## 21. Current next-work order

Do not revert to older branch status documents that listed already completed durable work as `NEXT`.

Current required order:

```text
1. Strict COMPLETE workflow wiring
2. Focused regression + exact-SHA CI
3. Patch / Review Packet workflow wiring
4. Role / Search Gate shadow verification
5. limited gate activation only after shadow safety proof
6. close remaining 11 capability gaps by responsibility
7. model A/B
8. real full closed-loop E2E
9. PR final audit
10. wait for Master approval before merge/deploy
```

---

## 22. Production/source separation

At the reviewed snapshot:

- GitHub branch head: `926dda4d17d739452b06e07f23ea5de8a5b8b800`;
- PR #21: open, draft, unmerged;
- main merge: not done;
- deploy: not done;
- production change: none from this branch;
- known server live checkout recorded separately as older source and must not be treated as equal to the GitHub branch.

Never run an implicit server pull/reset/sync merely because GitHub source advanced. Server Runtime remains Docker/Compose based; do not install persistent host Node/npm as a shortcut.

---

## 23. Stop conditions

Stop and report rather than forcing success when:

- a required contract conflicts with current repository behavior;
- a proposed change creates a second execution authority;
- a test would require weakening approval/repository/sandbox/evidence safety;
- a durable record would need hidden model reasoning or credentials;
- repository revision or required evidence is unavailable;
- a stale/unknown durable format cannot be proven compatible;
- a required check was not executed;
- a review result is UNKNOWN/PENDING when PASS is required;
- archive/receipt state is missing for a destructive GC action;
- CI/runtime evidence belongs to a different SHA/environment.

Valid outcomes include `BLOCKED`, `UNKNOWN`, `NOT_EXECUTED`, and `NOT_VERIFIED`. They must never be rewritten into success.

---

## 24. Definition of DebugAI complete

The whole DebugAI project is not complete merely because durable continuation or individual modules pass.

A final completion claim requires all of the following to be closed with evidence:

1. six-role execution contracts and required role/tool/skill behavior;
2. deterministic verification and invariants;
3. authoritative evidence behavior with explicit evidence gaps;
4. durable restart/continuation and replay-safe work reuse;
5. patch candidate / explicit approval / apply receipt boundary;
6. repository revision binding;
7. fresh local review;
8. required external review boundaries;
9. Strict Completion Gate connected to real workflow evidence;
10. remaining capability gaps closed or explicitly removed by an approved design change;
11. real closed-loop E2E on the intended runtime path;
12. exact-SHA CI and final audit;
13. any required production rollout verification after explicit Master approval.

Until those conditions are satisfied, the correct project-level state remains **not fully complete**, even when individual subsystems are verified.
