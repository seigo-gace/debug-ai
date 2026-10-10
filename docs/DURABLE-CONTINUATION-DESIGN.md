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

### 6.4 Role output correctness — additive source delta, 2026-10-08

The earlier `expected_any` check admitted malformed Code Scout localization,
invalid diagnosis statuses/fields and empty patch operations even with explicit
semantic enforcement. Diagnosis hypothesis and root evidence references were also
outside the central binding traversal unless duplicated in `claims`.

Reuse `role-output-validator.js` with the existing invocation compiler. Code
Scout requires all five production localization fields with typed string arrays
and a null or typed contract mismatch. Diagnoser requires its four production
fields, unique hypothesis IDs, typed references and falsification conditions,
valid statuses, counter-evidence for REJECTED, and no active HYPOTHESIS under
NO_ACTIVE_HYPOTHESIS. UNKNOWN and INSUFFICIENT_EVIDENCE remain valid; empty support
does not become confirmation. A non-null confirmed root is a statement/reference
object, with non-empty support cited by an active hypothesis and a compatible
diagnosis status. This makes support inspectable; it cannot prove the causal
chain by itself. Patch Engineer requires non-empty typed candidate operations;
repository/path/exact replacement and deletion authorization remain PatchService
and patch-core responsibilities, not a second patch engine.

Structural role checks remain WARN in default shadow and fail closed only under
explicit enforce. The existing observed production workflow's enforce context
is preserved; this delta does not activate a new global mode. Existing hard claim validation and Evidence binding remain
independent of this mode; the binding traversal also covers diagnosis hypothesis,
counter and root references. Registered-window membership is checked for all
references in strict mode, and for runtime TRE_/EVI_ IDs in compatibility mode.
Malformed individual reference IDs are rejected without string coercion. This
does not invent freshness metadata: the caller owns the admitted current window
and Source/Runtime identity. Structural validity, binding validity and actual
task correctness are separate conclusions.

P0-A follow-up (2026-10-10): Existing role-output-validator checks top-level
Researcher evidence_refs through the same registered evidence window as other
claim and hypothesis references: TRE_/EVI_ IDs fail on unknown in compatibility
mode, and all unknown IDs fail in explicit strict mode. The independent
rejected_source_refs field retains semantic string-array checks, not evidence
admission checks. Optional Causal Scout benchmark fields failure_family,
causal_chain, unsupported_links, alternate_hypotheses and confidence, plus
Researcher bound_version, now receive typed shadow/enforce checks while
preserving legacy omitted fields and the existing six roles/model profiles.
Offline role-tool-loop tests verify this plumbing with stubbed AI responses;
they do not qualify live model output or complete-product dogfood.

Compatibility: preserve default mode, Causal Scout/Researcher/Reviewer shapes,
WeakMap-only shadow storage and existing transport/state/approval contracts.
Legacy partial Code Scout/Diagnoser/empty operation output can still be parsed
in shadow, but no longer receives a contract PASS. Reverting this source delta
restores the previous checks without persistent-state migration. No Runtime
reflection is implied. Regression authority:
`server/tests/role-contract-correctness.test.cjs` and existing semantic/tool tests.

### 6.5 Dirty Git snapshot identity — additive source delta, 2026-10-08

The existing Git RepositorySnapshot hashed HEAD and porcelain status only. Two
different versions of an already-modified tracked file produced identical IDs.
Bind a bounded binary tracked diff against HEAD, including staged/net worktree
changes and file modes, into the existing Git snapshot hash when status is dirty.
Disable external diff and textconv so repository configuration cannot substitute
another program/output for the source comparison. Preserve existing file/byte
limits and fail-closed content-tree fallback when Git is unavailable or fails.

Clean Git IDs remain byte-compatible with the previous HEAD/status contract.
Dirty IDs change intentionally; historical dirty checkpoints must fail closed
rather than be silently rebound. Untracked files remain excluded from this Git
scope. This is a point-in-time source binding, not a claim of atomic filesystem
capture or complete candidate construction. Existing BASELINE/isolated CANDIDATE,
approval and Strict Completion gates remain necessary. Rollback restores the old
Source implementation without persistent-state migration; it must never rewrite
saved checkpoint identities. Git binding unit regression authority:
`server/tests/repository-snapshot-auto-bind.test.cjs`. These tests inject command
evidence so the existing Sandbox needs no Git executable or permission changes.
Actual Git execution regressions are separately run through
`ops/tests/repository-snapshot-real-git.test.cjs`; unit/Sandbox PASS does not imply
that executable is configured inside a sandbox job.

### 6.6 Source search coverage — additive source delta, 2026-10-08

The existing bounded source search returned an empty match array when a query
appeared beyond the 128000-character read prefix, without exposing incomplete
coverage. Reuse the existing walk/read/search and Tool Result/Evidence contracts.
Keep the result `data` match array and tool arguments unchanged. Add optional
`integrity.search_coverage` with query, inspected paths/counts, limits, file/match
cap flags, directory/read errors and truncated-file count. Bind the receipt into
the existing result digest/Evidence ID and reject tampering. Legacy Tool Results
without a receipt retain their old digest and integrity validation; their search
coverage remains UNKNOWN, not implicitly complete.

COMPLETE_WITHIN_SEARCH_SCOPE means the selected regular searchable files were
fully read within the existing exclusions, not exhaustive repository absence.
Any cap, read failure or truncation marks INCOMPLETE. File-cap detection is
conservative at the limit. `repository_absence_proven` stays false even for a
complete scoped query. Preserve source/permission/Secret filtering; no new search
engine, tool, traversal expansion or MCP interface is introduced.

Existing evidence projections prepend a small coverage summary before bounded
matches, retaining the full receipt in durable results for admitted evidence.read.
Source identity/admitted-window checks remain the owning workflow's responsibility.
The invocation compiler explains scope and zero-hit limits without supplying any
benchmark answers. Rollback removes optional receipts and restores old Source
behavior; historical Evidence IDs are never rewritten. Regression authority:
`server/tests/source-search-coverage.test.cjs` and existing tool-loop tests.

---

### 6.7 Patch Engineer evaluation oracle — additive source delta, 2026-10-08

The existing role-only Patch Engineer skill-effect scorer awarded full credit to
the BLOCKED case with required arrays set to null, because missing or malformed
arrays became empty arrays. Array members were also string-coerced. The scorer
now checks actual string arrays, exact reproduction keys and typed explicit
limitation/rollback fields before awarding the associated points. Valid fixed
outputs retain 5/5; partial scores retain their individual check meanings.

This is deterministic evaluation correctness, not a production contract change
or a model-quality result. Existing benchmark cases, paired inputs, prompts,
model assignments and historical 60-case codegen results remain unchanged.
No Python execution, live model rerun, candidate application or semantic repair
success is inferred. Negative and independent malformed-member cases run offline.

### 6.8 Runtime Packet immutable handoff — Step 12 source delta, 2026-10-08

Patch/Review Packet creation previously froze only outer containers and retained
references to nested checks, requirements carried in invariants, and hash maps.
Changing a caller's failed-check status or nested acceptance condition altered
the packet while retaining its original digest. The existing packet provider now
copies and recursively freezes JSON-shaped payloads before computing the digest.
Caller inputs remain writable; issued packets reject nested mutation. Existing
schemas, payload fields and digests for unchanged plain data remain compatible.
Both packet types reuse this one provider; consumers and approval paths are unchanged.

This closes the reproduced immutable-handoff defect only. Independently required
structured requested/preserved/forbidden behavior, acceptance, UNKNOWN and test
contracts are still missing from the current workflow caller. No such fields
are invented from task text. Their integration requires isolated caller ownership.
Baseline/candidate materialization identity and language oracle qualification are
separate prerequisites. This change does not qualify Python execution, a live
workflow, model semantic accuracy or Strict Completion.

### 6.9 Structured Requirement/Evidence handoff — Step 13 source delta, 2026-10-08

The old workflow supplied task/context beside a v1 Patch Packet, and neither the
packet nor candidate hash bound explicit preservation/exclusion/test obligations.
The existing provider now emits v2 only when a requirement input or prior v2
packet is supplied. Constructor-only legacy v1 calls and old stored digests remain
unchanged. v2 includes the typed `debugai.requirement-evidence/v1` contract:
explicit requested/preserved/forbidden behavior, forbidden paths, acceptance,
boundary/negative cases, UNKNOWNs and required tests. Each is a string array or
null when unavailable; no language-wide rule or intended behavior is inferred.
Original request, task and context are retained after existing Secret redaction.
v2 source/check excerpts are also redacted before hashing and binding persistence;
the observed source hashes still bind the original bytes.
Coverage means field presence, never semantic success; semantic_verification is UNKNOWN.

Origin is caller `context.requirements` or original analysis `failure.requirements`.
The existing durable input already persists failure/raw request; the workflow
reads that integrity-bound manifest on candidate generation after resume rather
than trusting a caller's replacement analysis. Conflicting explicit replacements
fail. Optional origin source/hash/Evidence assertions must match the current
packet's observed revision, selected-source hashes and admitted Evidence IDs.
Exact-string requested/forbidden contradictions fail; broader semantic conflicts
remain unproven and cannot receive PASS.

The existing workflow checks packet digest, current snapshot/source/Evidence and
forbidden operation paths after model handoff. PatchService checks again before
persisting, and the existing candidate hash includes optional requirement_binding.
Changed/dropped binding therefore changes the approval identity; stored candidate
load checks its integrity. Legacy candidates without a binding remain compatible.
No candidate is applied by this new path.

Existing bounded re-fix carries the original immutable contract through diagnosis,
Patch Engineer and replacement candidate. Its original revision/Evidence provenance
stays original; the outer new packet supplies fresh current source/retest bindings.
Legacy re-fix without structured input stays v1 and does not invent obligations.
Requirement fulfillment still needs identity-bound actual tests/semantic review.
Isolated materialized candidate, candidate snapshot/preflight/oracle and live
Strict Completion are later gates, not implied by this handoff qualification.

### 6.10 Sandbox snapshot integrity slice — Step 14 source delta, 2026-10-08

Gate 1 retains PatchService create/load, preparePatchCandidate, requirement-bound
candidate identity, explicit approval and transactional apply. The existing
Sandbox still permits only node.check and package lint/typecheck/test/build.
No permitted candidate-construction operation currently connects PatchService
to an isolated writable candidate workspace. This CU therefore implements the
independent manifest/completeness slice authorized by Step 14, not Phase 3 completion.

The existing copySnapshot provider now inventories the allowed tree deterministically:
normalized path, regular-file/directory type, exact byte hash/length, executable
bits, empty directories, file/entry/byte totals, limits and explicit exclusions.
Protected contents are not read; unsupported symlinks are recorded by target hash
without dereferencing. The manifest and nested arrays are immutable in memory and
have an integrity digest. This digest identifies allowed snapshot material, not
a replacement RepositorySnapshot authority or an authenticated signature.

Copies go to new destinations outside the source. Source is re-inventoried after
copying; destination entries are independently re-read and compared, including
extra files, omissions, changed bytes and executable bits. Existing destinations,
overlaps, path aliases/traversal and symlinked parents fail closed. Required paths
must be present regular files; omitted/excluded/dependency/native/symlink-backed
requirements throw SANDBOX_SNAPSHOT_INCOMPLETE before publication. Node check
requires its target; package actions require package.json. Additional requiredPaths
must be explicitly supplied; no dependency graph or required asset is inferred.

New existing-schema jobs retain this manifest in source_snapshot. The sidecar
rechecks it before existing artifact provisioning; execution rechecks again before
the helper probe/command. Only existing exact-source package-test provisioning
admits top-level build/node_modules artifacts after its unchanged provenance checks.
Landlock/seccomp, action/network/socket/environment restrictions are unchanged.
Legacy v1 requests without manifests remain executable but snapshot qualification
stays NOT_VERIFIED. No old candidate/approval hash is reinterpreted.

MATERIALIZED_ENTRIES_MATCH proves only copied entries, not whole-repository
completeness. Completeness remains NOT_VERIFIED, exclusions retain their reasons,
and candidate construction remains NOT_CONFIGURED. Command PASS requires a real
zero exit without timeout and is carried separately from these qualifications;
an injected pass flag with a failed exit cannot manufacture PASS. A candidate
argument to prepareSandboxJob is rejected as construction NOT_CONFIGURED.

New tests are LOCAL_FIXTURE_ONLY. Source/CI does not prove immutable physical
BASELINE storage, isolated multi-file candidate construction, candidate diff/re-read
bound to original requirements/revision, a generated-language oracle, live Runtime,
semantic correctness or Strict Completion. Those are the next exact construction
gate under the existing security/action authority; no Host execution, Python
substitute, new Sandbox/tool/executor, deployment or production apply is authorized.

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

### Step14 Gate3 resumption — upstream test contract correction (2026-10-09 JST)

The actual upstream feature branch now includes the reviewed and verified
health-only CHAT read fixture correction from PR #57 (squash merge
`b3dcffc55e9a2b7844474ff08ae43a5344659bea`). Previously, the PR #56
integration run failed Verify/Core because upstream selected
`service.debug_ai_health` without a GitOps status ID but three existing
test expectations still assumed `project.git_head` and an active GitOps ID.
The isolated PR #57 checks passed; independent draft PR #58 combined the
unchanged Step14 source with the current upstream target and corrected test,
qualifying six Actions and a real isolated full-suite 549/549 with no skips.

This is an additive **source/CI evidence checkpoint**, not a design rewrite,
live reflection or assertion that a prior PR #56 integration SHA passed.
The existing snapshot integrity implementation and fail-closed behavior remain
unchanged. Gate3 on PR #56 requires fresh six-workflow results for its new
exact HEAD with the corrected upstream integration; any failure remains
BLOCKED and its original evidence stays visible. Whole-tree completeness,
isolated candidate construction, generated-candidate semantics, live Runtime
and Strict Completion remain NOT_VERIFIED or NOT_CONFIGURED as applicable.
Review/GitHub Project/Host owner and approval boundaries remain unchanged.

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

## Design history — 2026-10-07 bounded control transport extension

The HTTP/CLI/MCP transport surface now connects the existing Bounded Server Command and Guarded GitOps paths directly. Added HTTP POST routes are `/v1/server-command/request` and `/v1/server-command/status`; existing GitOps request/status routes are reused. Four MCP tools are appended after the original nine: `debugai_server_read`, `debugai_server_status`, `debugai_gitops_request`, `debugai_gitops_status`. MCP delegates to the existing CLI; CLI forwards structured JSON to HTTP. Request/status delegate to existing service contracts without a second service, executor, queue, workflow, allowlist or approval owner. This is an additive transport extension; removing the new registrations/routes/CLI commands reverses the extension while preserving the original paths. All existing repository, approval, exact SHA, candidate identity, file scope and remote readback boundaries remain authoritative. Source tests/CI do not authorize or establish Production reflection.
