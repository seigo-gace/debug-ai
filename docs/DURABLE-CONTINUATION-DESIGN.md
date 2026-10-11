# DebugAI Architecture and Durable Continuation Design Authority

Status: **ACTIVE DESIGN AUTHORITY — CURRENT IMPLEMENTATION ALIGNED**

Repository: `seigo-gace/debug-ai`

Branch: `feat/durable-role-continuation-final-20260928`

Implementation snapshot reviewed for this revision: `926dda4d17d739452b06e07f23ea5de8a5b8b800`

Base main snapshot: `9171102bee023e57e84f1f933b4405137e891a6d`

PR: `#21` (`OPEN / DRAFT / UNMERGED` at the reviewed implementation snapshot)

Purpose: define the complete DebugAI execution architecture, durable-continuation model, AI-side control plane, evidence model, approval/review boundaries, storage/retention policy, completion contract, verification gates, and current implementation boundary without silently treating pending wiring as complete.

> Documentation completeness is not implementation completeness. This document describes both implemented behavior and explicitly pending behavior. A component, module, or test existing in source is not sufficient to claim runtime completion unless the real workflow calls it with authoritative runtime evidence and the required verification has passed.

> **Current optimization design addendum (2026-10-11):** Section 26 is the proposed engineering contract for input-token preflight, evidence delivery, model-runtime qualification and measurable same-work-item progress. Historic branch/SHA/status snapshots in earlier sections are retained as historical records; section 26 does not overwrite their provenance or represent production activation.

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

The existing measured/role-specific optimization order below remains authoritative. Section 26 refines its execution prerequisites, including pre-dispatch token admission and role-specific progress validation; no implementation or performance PASS is implied by this design change.

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
Researcher bound_version, answer strings and string contradictions now
receive typed shadow/enforce checks while
preserving legacy omitted fields and the existing six roles/model profiles.
The existing Invocation Compiler now issues Causal Scout and Researcher
production OUTPUT_FIELDS contracts matching their benchmark response shapes;
existing role-specific skill, model and runtime ownership remain unchanged.
Benchmark-only exact UNKNOWN answer expectations are not imposed on the
production workflow: an evidence-insufficient explanation remains valid while
claim/evidence binding and status stay independently enforced.
The existing Causal Scout/Researcher skill-effect benchmark graders no
longer coerce non-string array members into strings for scored fields;
malformed evidence, alternate hypotheses or contradictions cannot earn
normal typed-array credit. Historical score artifacts are not rewritten.
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

For the 2026-10-11 proposed multi-model qualification sequence, see section 26.8. The figures in this section are historical, configuration-bound measurements and must not be treated as current end-to-end latency, default sampling recommendations, or guaranteed performance.

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

The sequence below is the historic reviewed snapshot's order. For the later distinct AI Core optimization CU, use section 26.9 without displacing the active DebugAI Project Current, Module PR103/PR101 ownership, or protected Host admission.

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

### Six-role Module acceptance delta — 2026-10-11

Master prioritizes independent Module qualification before the separate 600s,
token and context optimization work. PR100's role-owned continuation adapters
are reused; PR101 remains the independent test branch, never a release branch.
Researcher E now has the same explicit opt-in hook as the other five roles.
Its item identity is `researcher.E`; A-D remain in the existing work-unit registry.
An E CONTINUE is committed before the pending interruption returns. The existing
Researcher checkpoint retains A-D and does not publish its final result or let
Diagnoser proceed until E has passed the existing role-result validator.
Existing models, legacy read-only Tool Loop, Evidence and approval paths remain.
The opt-in bounded model interface continues to prohibit tool execution; it does
not silently replace the legacy tool-capable role path or enable production.

Independent real-file/process tests exposed a lost-generation race masked by
memory authority fixtures: parallel work-item commits each read the same manifest
before CommitProtocol's mutex. RunAuthority now queues manifest read/evolve/commit
as one per-run operation. Only writes wait; model/Scout workflows remain parallel.
The store supplies its expected manifest input reference, checked inside that
queue, so two stale same-item writers cannot both publish. Execution epoch is
captured before queuing and checked before commit; takeover still fences queued
old work. CommitProtocol's native lock, immutable records and fences stay intact.
Rejected alternative: retrying a stale whole manifest (can lose peer progress).
Rejected alternative: serialize Scout model calls (violates independent workflows).

Focused acceptance covers E CONTINUE/resume/replay, A-D and Scout non-reexecution,
downstream blocking and independent/stale write behavior. PR101 separately uses
real native locked file IO and three child processes to prove all six adapters'
checkpoint/restart/completion/replay with canonical fixture outputs. Deterministic
completion proves only fixture objectives; JSON role validation is not independent
proof of real debugging semantics. Short gated local API protocol, role-specific
semantic completion and production activation are distinct qualification states.
Rollback: disable `enableHorizontalResearcher`, or revert this delta on the owning
product branch. No durable format migration or new execution authority is added.

The HTTP/CLI/MCP transport surface now connects the existing Bounded Server Command and Guarded GitOps paths directly. Added HTTP POST routes are `/v1/server-command/request` and `/v1/server-command/status`; existing GitOps request/status routes are reused. Four MCP tools are appended after the original nine: `debugai_server_read`, `debugai_server_status`, `debugai_gitops_request`, `debugai_gitops_status`. MCP delegates to the existing CLI; CLI forwards structured JSON to HTTP. Request/status delegate to existing service contracts without a second service, executor, queue, workflow, allowlist or approval owner. This is an additive transport extension; removing the new registrations/routes/CLI commands reverses the extension while preserving the original paths. All existing repository, approval, exact SHA, candidate identity, file scope and remote readback boundaries remain authoritative. Source tests/CI do not authorize or establish Production reflection.

## 25. Scout observation, scoped intake and local Stage reuse — Codex 2026-10-10

Purpose remains the complete evidence-grounded debugging loop. This delta addresses
P0-B and accepted §13 queue/evidence rules, using the real dogfood
`run_mv24304l_700ed16315` at `0a459cd857f3aafb44c5561f0ebb516f633fbf51`:
Sandbox reproduced four failures in five tests in 656 ms; the Run entered RETRY_WAIT
with AI_CORE_TIMEOUT after 1092.277 seconds. Historical evidence lacks failing
Scout identity and queue/prefill/decode timings. Serialization is a source fact,
not an established cause of that latency.

### Observation and continuation decision

Reuse `ai-core.js` measured telemetry and Tool Loop's existing v2 projection.
Per-Scout AI calls emit invocation/model/role, dispatch attempt, queue/prepare/
upstream/response/terminal phase, actual timestamps and failure classification.
Existing RuntimeEvidence, TGserver log sink, inspect/status and bound current-run
trace expose the same observations. Persist sanitized execution failure through
existing immutable WorkflowData/manifest refs so restart retains it; never retain
raw backend body, prompts, Secrets or hidden reasoning in this diagnostic record.
Provider prompt-eval/decode/token data absent from the response remains null
(UNKNOWN). Upstream wait cannot identify model loading, prefill or generation.

A 60-second heartbeat is observation, not productive progress. The last progress
clock changes only on a phase transition. At 120 seconds without a phase change,
`REVIEW_CONTINUATION` makes the wait visible to the controlling parent; it neither
asserts NO_PROGRESS nor automatically cancels healthy generation, changes deadline,
selects another model, dispatches another inference or spends external quota.
Existing Deadline/Retry and Tool Loop ProgressController remain authoritative.
Tool evidence/work/effect deltas, not heartbeats, establish productive progress.

### Scoped initial investigation

Reuse RepoPolicy, blocked-read paths, `readText`, test inventory, Evidence Registry
and existing tools. Supply up to four bounded explicit/mentioned source/test
excerpts, file hashes, configured test inventory, executed failing test output,
repository revision and registered evidence IDs. A dependency-free scope with
implementation source and a reproducible failed configured test starts locally;
upfront knowledge/official broad queries are deferred. Test-only/missing scope,
nonexecuted checks or declared dependencies retain normal discovery. Scope is
PARTIAL, never exhaustive. Additional read/search, counter-evidence and Researcher
authority tools remain available for actual missing facts. No six-role contract,
model, Work Unit definition, Evidence binding or final gate is replaced.

### Independent completed Stage reuse

PR82 generalized six-role continuation was reverted at `1856c95…`; do not resurrect
it. Keep specialized Researcher A/B/C/D/E/checkpoints. Save each complete Scout
through existing immutable Stage records independently. Preserve parallel Scout
orchestration and globally serialized adapter dispatch. Only durable commit
read/evolve/write operations are ordered within the owned Scout execution; no
second persistent queue or state authority is introduced. Settle both Scouts
before marking failure, preserving a healthy peer's result and preventing late
Stage commits from overwriting RETRY_WAIT. Failure cursor identifies the rejected
Scout. This does not claim measured concurrency or latency improvement.

Reuse requires the existing revision plus full existing source-tree hashing
(including untracked test/package bytes), persisted input digest, current role/tool
contracts, model/skill/invocation/validator/runtime implementation hashes and
qualified context/Node platform identity. Each Scout additionally binds exact
system/user/evidence input. A Stage is valid for at most 30 minutes, with future
timestamps/clock rollback rejected. Snapshot failure, missing legacy binding,
expired/incomplete output or unstable tools disables reuse. Revalidate role output,
registered references and tool integrity on restoration. Only source/test tools
are eligible for whole-Scout reuse; knowledge/authority/history/state/runtime reads
remain nonreusable. Corruption fails closed. The existing repository-revision gate
still blocks changed-source continuation before inference.

Save and reuse successfully collected, network-isolated local **failing** reproduction
observations as historical evidence under the same binding/age checks. Passing or
timed-out checks are not promoted to present verification; fresh post-apply retests
remain mandatory. Reuse receipts explicitly say `new_execution=false`. A previously
complete research context receives the same binding/age admission; existing
Researcher input-binding checks remain active. This is Stage reuse within the
existing owner, not a new state/cache/workflow engine.

### Acceptance, ownership and rollback

Codex owns Scout/AI adapter/observation and initial evidence intake. Branch stacks
on fresh PR92 `500e5d944e98d0d31cdac7e7c46a206bc1b16f41`; its automaticRefixCandidate diff remains untouched. PR88
Role Output/Prompt, PR90 Patch Packet and PR91 Sandbox boundaries remain their
owners' work. FREE review, quotas, Ledger and Strict Completion contracts are
unchanged. No new MCP/workflow/Token/Provider or top-level project.

Focused offline regressions require identity-bearing timeout/queue failure,
UNKNOWN provider timings, periodic observation without normal cancellation,
current-run trace isolation, exact restart reuse, stale/input/context/source/test/
clock/corruption rejection and preserved discovery for evidence gaps. Fixture/model
mocks prove routing and invariants only. Source/CI, Host admission/reflection and
real model latency/accuracy are separate gates. The 18-minute real case is a
baseline failure, not an improved real performance result. No 50/60/100 suite or
Groq/Gemini call is part of this CU. Next gate after Source/CI is admitted runtime
reflection and one real scoped Dogfood with timing and correctness readback.

Rollback is an ordinary forward revert of this delta; preserve immutable evidence,
existing role/checkpoint state and FREE Ledger. Old Stage schemas remain readable;
missing reuse binding simply declines reuse. No retention, writer fencing, approval
or quota bypass is introduced.

Scout tool waits use the same Run Evidence/status/trace lane (`tool_invocation`):
60-second observations distinguish TOOL_WAIT from AI queue/upstream wait, retain
the original last-progress time, and offer the same advisory continuation assessment.
Only role/tool identity and elapsed time are retained; tool arguments/results are
not copied into telemetry. Existing Tool Runtime deadlines and retry decisions stay
in force. PR92 integration baseline is now `54c13a9f32a74758681476e6c5a4bf4166359978` (includes the owner's P1-D CI reconciliation; no independent Patch Engineer edits).

Live recovery readback on42918b7 exposed a parallel cursor residual: saving the
completed Code Scout marked CODE_SCOUT/PENDING while Causal Scout was still
UPSTREAM_WAIT. The bounded correction preserves the immutable successful Stage
but projects the still-running peer's step/input/RUNNING status to the existing
single cursor and workflow_progress. No additional Work Unit is introduced.

Invocation records carry a local event_sequence for deterministic readback when
multiple observations share a millisecond. Scout inspection chooses an actually
recorded progress event matching the authoritative durable cursor; UUID filename
ordering is not execution ordering. This creates no additional durable owner.

### Post-apply Reviewer continuation and six actual hook acceptance — 2026-10-11

The final Source audit found a second gap: Local Reviewer was connected only at
hypothesis fallback, while its primary post-apply review still invoked once.
The same explicit `enableHorizontalLocalReviewer` now connects final review to the
existing Module. Before the first bounded review call, existing RunAuthority stores
an integrity-bound `approved_verification` stage with candidate/hash, applied
receipt, deterministic retest result and post-apply Source revision. A subsequent
same-candidate approved entry restores that stage and continues review without
reapplying or rerunning retests. Candidate/hash/repo/revision mismatch refuses
resume. Final review is cached in the existing stage store after Strict Completion;
completed replay repeats neither model nor final provider. Terminal manifest status
remains DONE/BLOCKED; unresolved final review remains PAUSED. No auto-approval,
new API/transport, hidden model state or second mutation authority is introduced.
The legacy default-off path and its tool-capable Reviewer remain unchanged.

Independent actual-hook fixtures now exercise concurrent Scouts (successful peer
saved once), E with A-D retained, Diagnoser, hypothesis Reviewer, Patch Engineer
(candidate only after COMPLETE and still WAITING_APPROVAL), and final Reviewer
(2 model steps, apply1, final provider fixture1, replay0). Native process acceptance
remains PR101-only. Real API evidence remains the short same-Coder protocol with
explicit CONTINUE/COMPLETE envelopes, not six-role real debugging correctness.
Separate re-diagnosis/preapproval/re-fix and standalone read-only verification
invocations retain their existing paths; this delta qualifies the primary six-role
workflow hooks, not every auxiliary invocation in the product. Those secondary
paths and automatic post-apply startup scheduling are NOT_VERIFIED for horizontal
continuation; the saved final review is resumed through the same approved entry.

---

## 26. AI Core input, model runtime and semantic-work optimization — proposed design revision, 2026-10-11

### 26.1 Purpose, change boundary and evidence grades

**Intent:** make the existing four local 7B/8B models and six specialized roles usable at their qualified capability, without weakening the whole DebugAI evidence-driven debugging contract. Optimize *correct verified work completed per elapsed time and resource used*, not shortest answers or highest nominal context alone. In the Master analogy this improves the fuel delivery, workload control and measured engine operating point; it does not replace or downsize the engines.

**Design status: PROPOSED / NOT YET IMPLEMENTED / NOT DEPLOYED.** This section is an approved-scope design amendment and implementation plan, not a new workflow, executor, source patch, admission policy or production assertion. The final selection of thresholds, sampling and rollout depends on measured qualified runtime evidence. New facts must update this section through ordinary owning-branch review, not through untracked prompt heuristics.

**Authoritative existing parts to reuse (source-confirmed):**
- One RunAuthority / native commit and fencing protocol / Work Unit Registry / RoleResult / Effect Ledger. Never duplicate or migrate these merely for optimization.
- Six intact role/model contracts in server/roles.js and server/control/model-profiles.js; role-specific budgets in server/control/role-runtime-budgets.js.
- Existing AI Core telemetry, queue and prompt-cache request in server/adapters/ai-core.js; existing Tool Loop and context-compression.js; Evidence Registry, source/evidence.read, active-evidence-window.js, deterministic validators.
- Original Researcher A-E units, concurrent Scout workflows with a globally serialized effective AI Core slot, and strict patch approval, post-apply retest, fresh review and completion controls.
- Existing same-item Module from merged PR100. Product PR103 and independent test PR101 provide separate Source and test evidence: primary opt-in six-role hooks, Researcher E/final Reviewer, fenced native checkpoint saving, and a short two-call local Coder CONTINUE/COMPLETE protocol. They do **not** establish actual six-role debugging semantics or production deployment.

**Observed, not inferred:** The historical dogfood recorded Code Scout prompt evaluation about 146.5 seconds, Causal Scout about 161.4 seconds waiting in a queue and a separate upstream timeout near 600 seconds. Later original run readback was BLOCKED at Diagnoser with AI_CORE_TIMEOUT. These are different observations/stages, not proof of one common context-root-cause. Production n_ctx per slot, actual prompt token budget for the failing request, model load/swap time, memory pressure causality, response streaming support and final correct diagnosis remain **UNKNOWN** until Host readback.

**Separate candidate:** Draft PR102 (branch fix/ai-core-bounded-retry-wall-budget-20261011, HEAD at review 27d67300a6684baccb9c6e5582b12a072079e783) has source changes for one invocation-wide transport retry deadline and prompt-size diagnostics; four GitHub CI workflows passed that exact SHA. It is **not** merged, deployed, or proof of lower real-model latency. Inspect the exact diff/test/race semantics before considering integration, especially caller-supplied deadline/queue exclusions. Do not cherry-pick or redevelop it automatically.

### 26.2 Invariants and separation of concerns

1. Keep model IDs, GGUF artifacts, role split, Thinking mode and sampling unchanged until the corresponding exact-host experiment qualifies a difference. Official model-card defaults are comparison candidates, not an order to change production.
2. Do not equate a model's advertised context length with the loaded GGUF/runtime/per-slot available context. Model capability, model-generation ceiling, effective slot context, input size and requested output allowance are different fields.
3. Maintain authenticated model/tool/evidence boundaries and data-not-instruction classification. Never add a new orchestration authority, second continuation engine, project sibling, workflow, MCP, secret or paid-model test.
4. Store no raw hidden chain-of-thought. The durable work item holds only externally verifiable progress, provenance, incomplete items, budgets and validated final role output.
5. A successful API reply, JSON schema, checkpoint revision, changed text digest or heartbeat alone cannot prove productive semantic progress, source correctness or whole-product completion.
6. Never trim original source text, exact patch edits, required constraints, contradictory evidence or registered counter-evidence merely to make a context admission pass. Projection/selection affects only the next prompt view, not immutable source/evidence.
7. No state write/apply, final-review PASS, external free-tier review call or broader concurrency is authorized by the optimization work itself. Preserve current FREE Groq/Gemini ledger and permitted two review points.
8. Remain fail-closed at *the specific uncertain operation*, while independent read-only/source/fixture work continues. The original production path must not be changed by turning on proposed gates before shadow qualification.

### 26.3 G0 — read-only host/runtime identity and failure reconstruction

Before tuning, obtain from the existing authorized DebugAI product Host/read lane and its registered Evidence/Runtime logs:

- Canonical Host/source/image exact SHA, deployed branch, model alias -> loaded GGUF file/hash, effective llama.cpp and llama-swap versions/builds, model template and actual Thinking invocation settings.
- Qualified per-model effective context and slot count; loaded configuration, memory/container limit and current use/OOM signs; swap/unload policy and single-flight queue state. Do not expose raw model files, credentials or private prompt/evidence content in records.
- By role, count of invocations, queue wait, preparation, upstream request time, provider prompt evaluation, decode, input/output token counts, cache-hit/miss, termination class, attempt, received bytes and checkpoint commit. Record each unavailable provider metric as UNKNOWN/null, never zero.
- Distinguish wait before a loaded model is ready, prompt prefill, Thinking/decode, HTTP header/body wait, backend abort, validation/rejection and RunAuthority pause. Total request wall time does not identify its component by itself.
- Reuse the original historical run and artifacts first. Do not start another 600-second dogfood, six-model benchmark, whole 100-question suite or Groq/Gemini call merely for observability.

Exit G0 only with an immutable model/runtime identity matrix, a per-incident timeline with measured versus unknown columns, and evidence that each subsequent test will run against the intended exact runtime rather than an imagined generic configuration.

### 26.4 G1 — pre-dispatch, model-true input-token admission

**Gap:** The current resolveEffectiveMaxTokens path limits requested generation against model/runtime ceilings, but does not prove that the *actual formatted input plus reserved output* fits the executing model slot. Current 85% context compression is reactive to **previous returned** prompt_tokens; it cannot save a first request that fails before delivering usage.

Proposed change: add a narrow pre-dispatch admission decision at the existing AI Core/Tool Loop prompt-building boundary, without creating a new executor or separate tokenizer truth plane.

Contract:
- Input identity binds exact model/GGUF, serving version, effective chat template, Thinking kwargs, selected skills, system+user+tool payload, response format, prompt prefix and runtime slot capacity. A token count obtained from another model or unqualified template is invalid.
- Use the serving stack's supported template application and tokenizer read interface (for example llama.cpp /apply-template plus /tokenize), **only after proving** that the resulting counts correspond to the actual /v1/chat/completions path and observing backend usage to calibrate its agreement. Plain UTF-8 bytes and a raw-text token count are diagnostics, not an exact chat input allowance.
- Admit a call only when: measured formatted input tokens + bounded output reservation (including any Thinking budget) + qualified safety reservation <= actual per-slot effective context. The output reservation is a per-step *capacity request*, never a claim that those tokens will be consumed; do not force model-native maximum output for every small step. Exact reservation/overhead and token accounting must be measured and version-bound, not guessed.
- If counted input does not fit, choose the existing evidence-window selection/rehydration and same-item bounded step before any call. If mandatory data still cannot fit, return an explicit INPUT_CONTEXT_BUDGET_EXCEEDED/UNQUALIFIED status and preserve the work item. Never silently truncate required evidence or lie with a numeric guess.
- If exact token admission is unavailable, report TOKENIZER_OR_TEMPLATE_UNQUALIFIED. The gate is initially *shadow/read-only* in qualified testing; do not globally block an otherwise unchanged production legacy path based on an untested estimator.
- In failure and success telemetry, keep tokenizer identity, counted inputs, requested vs effective output reserve, observed provider usage, context capacity, count disagreement and refusal reason. No secret/raw prompt logging.

Acceptance: same-model exact-template fixtures including special tokens, long source snippets, mixed Unicode, Thinking/template variants and a near-boundary input must agree with backend usage within an empirically qualified tolerance. An over-budget call is rejected **before** expensive model dispatch; valid evidence-complete calls remain valid.

### 26.5 G2 — evidence-first, task-bound working context

**Reuse existing:** context-compression.js (recent five full tool results, up to fifteen retained historical pointers, 85% reactive threshold), active-evidence-window.js (up to twelve items / 12,000 excerpt chars, 2,400 per projection), Tool Loop evidence.read and durable originals. These numbers describe existing prompt-view controls; they are **not** proven optimal token limits and must not be mechanically replaced.

For each bounded same-work-item step, construct a deterministic *working-context view*:
1. Pin the fixed task, prohibited actions, acceptance predicates, source revision, candidate identity and exact role/evidence permissions. Pin all required evidence and counter-evidence IDs.
2. Carry the compact, validated previousProgress and explicit next unmet criterion. Select exact excerpts for this step from registered evidence; preserve integrity hashes, source bindings and provenance for every omitted body.
3. Use relevance and current unmet criteria to choose optional/recent evidence projections. Keep counter-evidence/contradictions mandatory where the role needs them; preserve UNKNOWN for facts not in the selected material.
4. If any required projection is absent, too large or no longer bound to the source, fail closed and arrange authorized evidence.read/repartition rather than dropping it or pretending its reference proves content. Rehydration remains a bounded, observable tool cost.
5. Maintain the static instruction prefix where safe for prompt caching; verify actual cache-hit and prefill savings. A shorter prompt that increases total tool calls/latency or loses verified facts is a regression.

Role-specific view requirements:
- Code Scout: exact relevant paths/call graph excerpts, inspected-scope boundary and negative-search coverage; no invented absence.
- Causal Scout: observed failures, competing links, alternative hypotheses and unsupported connections.
- Researcher A-E: source version, rejected/contradictory evidence and research completeness, preserving distinct A-D inputs while E resumes.
- Diagnoser: retained hypotheses, falsification conditions, counter-evidence and source-bound evidence IDs; no promotion of a hypothesis to fact.
- Patch Engineer: exact target code/spec, candidate-specific operation contract and deterministic test evidence; candidate-only, not apply.
- Local Reviewer: applied candidate/hash/approval receipt, independent retest results, all material regressions and contradictions; never reduce evidence merely to obtain PASS.

Acceptance: deterministic window tests for oversized mandatory evidence, corrupted ID/digest, missing projection, omitted contradictions, unauthorized rehydrate, prompt injection and source revision change, plus quality parity against an unchanged eligible baseline. Preserve evidence in the original registry regardless of prompt size.

### 26.6 G3 — semantic progress and strict same-item continuation

**Gap:** Existing Module continuation checks structure, validators, checkpoint revision and changed digest. The opt-in workflow intermediate contract currently requires registered evidence_refs and non-empty remaining_work. A different paraphrase can change the progress digest without proving that any original criterion has advanced.

Extend *role-owned validators*, not the generic RunAuthority, to judge measurable deltas in the same original bound work item. Define a small set of typed verified_work markers associated with fixed criterion IDs / existing Work IDs / admitted Evidence IDs (field names and versioning must conform to the existing checkpoint schema). For CONTINUE, require at least one independent state change: a newly verified criterion, a newly qualified nonduplicate evidence link, a falsified/updated hypothesis with bound proof, or a reduced explicitly enumerated unfinished work set. Mere text changes, repeated IDs, synthetic checklist increments, new unsupported guesses or a clock heartbeat are not progress.

Each role's validator and independent completion predicate remain separate:
- Code Scout: new inspected source edge or bounded coverage fact, never a fabricated repository-wide finding.
- Causal Scout: a new supported/refuted causal edge with retained alternatives.
- Researcher: new source-qualified evidence, contradiction resolution or distinctly completed A-E obligation; no E completion from an unverified sentence.
- Diagnoser: evidence-bound hypothesis state/falsification update, or explicit INSUFFICIENT_EVIDENCE as an honest terminal outcome rather than a false root cause.
- Patch Engineer: reproducible candidate operation/test delta tied to exact source and specification; it cannot apply the patch.
- Local Reviewer: independently validated review obligation and test/invariant finding; restored review must match approved candidate, source revision and apply receipt.

A nonproductive step returns existing NO_SEMANTIC_PROGRESS / blocked semantics without infinite retry. Persist only verified bounded progress and remaining criteria before another call; inspect readback across real process restart. Maintain the writer fencing and per-run commit queue from PR103. Do not promote a model's COMPLETE envelope without the current canonical role result validator and downstream independently checked predicates. Avoid schema migration without proving its need.

### 26.7 G4 — wall time, model load, transport retry and cache

The 600-second ceiling is a diagnostic boundary, not a target response time and not a solution to slow generation. Keep the present role timeout, globally serialized dispatch, queue discipline and retry permissions until measured G0/role qualification says otherwise. Do not increase timeout because a previous request failed.

Distinguish three budgets: queue admission wait, one model-invocation wall time across transport attempts (with caller absolute deadline semantics preserved), and overall same-work-item multi-step budget. Bound each by existing authority and document whether queue is excluded from an explicit caller deadline. An abort with no complete response yields *no* validated partial progress. If the effect/commit status is uncertain, do not blindly replay it; use authority/ledger readback and approved idempotency rules.

llama.cpp streaming/slot and KV features can reveal observability or accelerate a stable common prefix, but:
- partial stream bytes/unfinished JSON are **not** role results or saved verified progress;
- KV state is not durable semantic continuation and is not portable across unqualified model/swap/revision changes;
- saved slot caches must not be introduced as a second persistent authority or as an unreviewed security/retention path;
- provider absence of prompt/decode timings is UNKNOWN, not proof of model inactivity.

Measure model-load/swap and queue costs before any speculative increase in parallel slots, speculative decoding or different backend. Prior reported near-9GiB pressure is a capacity concern to investigate, not proof of OOM root cause.

### 26.8 Model- and role-specific qualification matrix

Keep the currently declared identities and baselines **unchanged** until actual runtime qualification. Separate *official capability*, *configured Source declaration*, *loaded GGUF/runtime slot* and *measured outcome*.

| Model and roles | Current Source facts | Qualification before changing behavior |
| --- | --- | --- |
| Qwen2.5-Coder-7B Q4_K_M / Code Scout, Patch Engineer | Shared Coder backend; Source profile declares 131,072 model context and up to 8,192 generation, historical ~14.66 output tok/s | Read exact GGUF RoPE/template and effective n_ctx; compare official GGUF ordinary-context/default versus any extended configuration; separately benchmark source traversal and exact patch candidate validity; no blanket short-answer cap. |
| Qwen3-8B Q4_K_M / Causal Scout | thinking=false; Source profile native 32,768 / extended 131,072; historical ~4.18 tok/s is shared model baseline | Verify thinking really off in the llama.cpp chat template and actual runtime; qualified short causal-hypothesis task; preserve alternatives/unknowns. |
| Qwen3-8B Q4_K_M / Diagnoser | thinking=true on same backend; current adapter default temperature 0 | Measure reasoning/final separation and hidden-reasoning budget impact; compare official supported sampling candidates in *isolated* one-axis tests with fixed facts, not production change by assertion. |
| Granite-4.2-8B Q4_K_M / Researcher A-E | current thinking=false; profile native 131,072 and extended 524,288; historical ~5.82 tok/s | Verify GGUF/template/runtime slot, source-qualified citation and conflict preservation; compare sampling only if needed; prove E resumes without repeating A-D. |
| Ministral-3-8B-Reasoning-2512 Q4_K_M / Local Reviewer | reasoning model, thinking field currently null; Source profile declares 262,144; historical ~7.98 tok/s | Verify exact reasoning template and final-content extraction, reasoning-only/empty reply classification, genuine independent review and contradictions; one-variable sampling tests only after correctness baseline. |

Historical tok/s figures are Source-recorded for a particular September 2026 Contabo sequential runtime gate, **not guaranteed throughput today**. Do not assume a model card's maximum context, generation limit or sampling recommendation is supported by the currently deployed quantized backend without GGUF/runtime evidence. Do not change model, subscription, provider, hosting or GPU capacity under this design.

### 26.9 Adoption order, bounded verification and completion gates

| Gate | Owning action | Required acceptance | Status at this design revision |
| --- | --- | --- | --- |
| G0 | Read-only current Source/Host/Config/Run evidence and provider metrics | Exact deployed model/template/slot/Memory identity and failure timeline; known vs UNKNOWN marked | PENDING runtime readback |
| G1 | Shadow exact-template/tokenizer admission using existing serving path | Accurate input+reserved output allowance; over-limit denied before dispatch; qualified-missing fails closed only in opted-in path | DESIGN_ONLY |
| G2 | Deterministic task-bound evidence projection/rehydrate | No required constraint, exact source, contradiction, digest or evidence is omitted; measured call/latency cost | DESIGN_ONLY |
| G3 | Role-specific verified work delta with current Module validators | All six roles reject paraphrase-only/no-progress and unsupported COMPLETE, survive restart and preserve approved effects | DESIGN_ONLY; Module protocol itself separately qualified |
| G4 | Model/runtime observability and bounded retry/queue integration | Distinct wait and inference causes; no duplicate expensive work; model quality not degraded | PR102 candidate only; unqualified real performance |
| G5 | Small local-model semantic acceptance from historical failure cases | Six role-specific correct evidence-bound outputs and same-item continuation; measure total time, tokens, quality, tool calls, prompt cache; no blind 600s loops | NOT_VERIFIED |
| G6 | Whole DebugAI real closed loop and authorized Host reflection | Exact-SHA/bytes, approval/apply/retest/review/final evidence, TGserver log and source/CI/runtime readback distinct | NOT_COMPLETE |

Order of execution: first G0, then G1-G3 offline/observational tests and compatibility review; G4/G5 only with bounded real local-model probes after the known root causes and rollback are recorded. A full 50+50 or 100-task quality benchmark belongs **after** integration qualification, not as a first discovery loop. Groq/Gemini calls for this optimization CU = 0. CI green alone does not qualify live model semantics or performance; Source design green is not a thing.

Success criteria for a change: non-regressing role outputs and registered evidence, strict approval/review/final gating, replay safety, and an explicitly *measured* improvement in correct terminal-work completion per total elapsed time or resources on matched tasks. An observed regression or UNKNOWN safety boundary blocks adoption. No preselected percentage, guessed tokenizer tolerance, made-up token target or claimed paper-derived speedup is acceptable.

### 26.10 Ownership, rollout boundary, exclusions and rollback

- The Codex-owned Module product CU remains PR103 with the independent PR101 test. Do not edit its role-work-item Source from the parallel optimization design CU. Existing Project Current reflects a blocked Host policy/admission boundary for PR103; only the verified trusted owner/writer can apply least-privilege branch/two-path admission (or the actual protected merge route), followed by exact deployment/source parity/health readback. Do not deploy the test branch.
- This design revision changes only this existing design file on a distinct documentation branch based on PR103, and should be reviewed as a stacked documentation-only PR into PR103. It is not a permission change, policy amendment, source implementation, release, source merge, external model call or Host execution.
- Once G0 facts are collected, only the named owner of each touched source path should implement G1/G2/G3. If the proposed path overlaps a Codex-owned file, record exact change requirements and hand off under **one** mutation owner; do not create competing edits. The separate PR102 must remain separately reviewed.
- Rejected now: rebuilding the continuation engine, introducing LangGraph/MemGPT as infrastructure, changing all four model samplers at once, truncating mandatory source/evidence, changing output cap based on unverified speed, globally enabling streaming/parallelism, saving hidden reasoning, or expanding Host/security/free-provider scope.
- Rollback proposed preflight and context optimizations independently, using an explicit opt-in/shadow switch on the existing path when implemented; preserve original durable records, candidate/receipt/effect identities and existing runtime budget behavior. A design-only revert has no production effect.

### 26.11 External evidence and scope limitations

The following are **external reference techniques**, not observed DebugAI improvements or a mandate to replace the local stack:

- llama.cpp server: supported slot inspection, template application, tokenizer interface, optional metrics, streaming and cache controls. Actual supported routes and access are build/config/version-dependent: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- Qwen3-8B official generation configuration (temperature 0.6, top-k 20, top-p 0.95 on its Transformers card): https://huggingface.co/Qwen/Qwen3-8B/blob/main/generation_config.json — candidate for isolated verification, not default replacement in llama.cpp.
- Qwen2.5-Coder-7B Instruct GGUF official distribution: https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF — validate exact quantized artifact and context path.
- Agentless (staged software repair): https://arxiv.org/abs/2407.01489 ; SWE-agent (bounded source interface): https://arxiv.org/abs/2405.15793 ; Anthropic long-running agent harnesses (checkpoint/progress contract): https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- MemGPT (external context hierarchy): https://arxiv.org/abs/2310.08560 ; Lost in the Middle (long-context position risks): https://aclanthology.org/2024.tacl-1.9/ ; LongLLMLingua (research-specific compression experiments): https://aclanthology.org/2024.acl-long.91/
- LangGraph durable execution (checkpoint/replay and side-effect/idempotency design patterns): https://langchain-ai.github.io/langgraph/concepts/durable_execution/

None of these external studies tested the exact DebugAI GGUF set, prompts, native Store and Contabo runtime together. Therefore no external paper's speedup, pass rate, context limit or framework safety property may be copied into DebugAI acceptance without its own matched evidence.

### 26.12 Integrated product-module handoff and historic runtime measurements — 2026-10-11

Master directed one integrated DebugAI product mission. **Do not conflate acceptance planes.** Product PR103 (Codex owner, Source/CI PASS, Host admission BLOCKED), isolated non-release test PR101 (Codex, short real Coder API protocol PASS), stacked design-only PR104 (GPT CHAT) and independently reviewed retry candidate PR102 (GPT CHAT, Source CI PASS, real performance UNKNOWN) remain separate branches. Reuse PR100/PR103 Module, original role contracts, RunAuthority, Effect Ledger and tools. Do not merge the PR101 test branch as a deployable product.

#### Recovered G0 facts (old runs, NOT new live tests)

| Evidence | Stage | Measured facts | Unknown |
| --- | --- | --- | --- |
| [Issue41#6096673968](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6096673968) | Older recovered Code Scout | 161,433ms total; prompt eval 146,514.168ms; decode 11,540.543ms; prompt 3,564 tokens; completion 73 tokens | Applicability to today's GGUF/runtime |
| [Issue41#6096673968](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6096673968) | Earlier Causal Scout | Queue 161,410ms plus upstream 600,003ms, DEADLINE_ABORT, attempt 1 | Backend prompt/decode and cause |
| [Actions run38062125213](https://github.com/seigo-gace/debug-ai/actions/runs/38062125213), [Issue41#6099024958](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6099024958) | Original run `run_mv24304l_700ed16315` Diagnoser, autonomous attempt3 | queue 0ms; prepare 1ms; upstream 600,003ms; wall 600,004ms; HTTP request 17,230 bytes; response 0 bytes; DEADLINE_ABORT; that API attempt1; provider prompt_eval/decode/completion-token metrics all null | Upstream loading vs prefill vs Thinking/decode vs transport |
| [Issue41#6104935524](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6104935524) | Reasoning-format-only probe | Timeout 600,012ms, final bytes0; cgroup memory.current equals reported 9GiB memory limit | OOM or memory pressure *causing* timeout |
| [Issue41#6107942804](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6107942804) | Independent PR101 live local Coder | Same work item, native durable CONTINUE→COMPLETE over 2 real calls in 4.713s | Real six-role debugging correctness and production activation |

**Do not infer model token count from 17,230 HTTP request bytes.** No repeated 600s probe is justified merely to reconfirm the timeout. The absence of response usage is UNKNOWN, not measured zero model execution.

#### Exact Host/Source admission boundary

Installed Host delegation `dlg_master_debugai_v1` was reported enabled and unrevoked, but PR103's branch `fix/researcher-e-continuation-20261011` is not admitted; two forbidden changed source paths are `server/run-authority.js` and `server/control/role-work-item/durable-store.js` ([Issue41#6107942804](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6107942804)). This is an authorization scope issue distinct from model functionality.

The canonical registry is existing `G-ACE-inc/server-core/operations/master-internal-repositories.json`; its current PR42 path set does not admit those two paths or PR103 branch. Keep existing operation `deploy`, `debugai.compose.reflect` scope and all five protected effects=false. Only the verified trusted policy owner/writer may reconcile exact branch and changed paths, perform registered `scripts/host-gitops-register-master.sh` installation, then read back installed policy digest. A GitHub file edit or Master technical-delegation statement is not an installed Host permission. PR42 source ownership must be reconciled before any overlapping edit. The already approved alternative protected merge route does not bypass changed-path admission.

#### Integrated priority and verified next gates

1. **P0 product gate (separately blocked):** Codex/policy owner resolves minimum branch+two-source-path admission, exact PR103 Source/CI, then existing DebugAI-only guarded reflection and installed Source/image/health/readback. No test-branch deploy, self-grant, new workflow/token or common server-core CHAT executor changes.
2. **P0 independent G0:** Use existing authenticated read-only lane to recover live GGUF digests, effective per-slot n_ctx and version/template, Thinking settings, model-switch timeline, backend slot/metrics, cgroup OOM/pressure and relevant provider usage. Tag every missing value UNKNOWN. This can continue while admission is blocked.
3. **P1 G1:** Shadow exact-template input-token admission against the actual serving path; fail closed only for qualified opt-in requests before production enforcement.
4. **P1 G2/G3:** Reuse Evidence Window, evidence.read and existing Module; require independently verifiable role-specific work deltas (not paraphrase-only digest differences). Codex-owned continuation files require one reconciled owner.
5. **P1 G5/G6:** A small matched local-model **real debugging** scenario, then authorized whole product loop with apply/retest/local review/required final gates. Full 50+50 benchmarking only after reliable bounded integration.
6. **P2 G4:** Review PR102 retry-deadline semantics against queue exclusion and caller budgets before adoption; hold unmeasured sampling, n_ctx/timeout changes or parallel model slots.

**Current acceptance:** PR103/101 Source/CI and scoped short API protocol qualified; deployed PR103 and full semantic/debugging success NOT_VERIFIED. PR104 remains design-only, no source/Host/provider changes.

### 26.13 Production reflection G0 correction — 2026-10-11

This section supersedes the older PRE-REFLECTION admission statements in §26.12 **for the PR103 deployed HEAD only**; it preserves historical prior blockers and separate semantic acceptance gates. Source owner Composer report was cross-read from [DebugAI #41 Host receipt 6108541911](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6108541911) and [#42 Host chronology 6108542062](https://github.com/seigo-gace/debug-ai/issues/42#issuecomment-6108542062). Do not infer new actual model capability from the configured runtime variable.

**Installed Host facts as reported by the authorized Host executor**:
- Installed canonical↔private `dlg_master_debugai_v1` equality `POLICY_CANONICAL_MATCH=YES`; policy digest `720e76ff6ff0491447ecd593163af86ab50cabce36ca140af2711629ed2f1839`; one product branch and two exact source paths admitted. Host canonical file was synced from source-qualified server-core PR97 HEAD `e691ecac899064fdecc39c3ee5271ce89c65a7f9`; this stacked PR remains unmerged, and origin/main need not equal installed Host canonical.
- Guarded DebugAI product GitOps operation `gitops_b63b3b358457d7a168194eb5` completed PASS for PR103 `490f180014961e5c5199c8e303681769c9bb8b45`; private health HTTP200/running|healthy, Host checkout HEAD and sampled SHA256 file parity; persistent authority/durable volume remained after Compose recreation/restart, recovery-enabled health. **Whole source-image byte parity** beyond sampled files was not claimed by this readback.
- AI Core URL `127.0.0.1:18080` points to llama-swap; four llama.cpp:server backends. Configured DebugAI `DEBUG_AI_CORE_CONTEXT_TOKENS=8192`. This env is the adapter's claimed runtime context, **not** a freshly measured per-model/per-slot llama.cpp `n_ctx` nor a full-chat-template tokenizer count.
- A Ministral cgroup limit 9,663,676,416 bytes (9GiB) and observed usage approximately 8GiB were read; no contemporaneous OOM-kill or model failure causality is proven.
- No new known 600s run, Groq/Gemini call or actual six-role semantic debugging qualification. Current continuation deployment is **SOURCE_REFLECTED_RUNTIME_HEALTHY**, not **HORIZONTAL_PRODUCTION_ACTIVE** or **SEMANTIC_COMPLETE**.

**Direct current source finding at deployed PR103 HEAD**: `server/main.js` constructs `createWorkflow({aiCore,externalReview,evidenceSearch,runtimeEvidence,tgserver,patchService,authority,repoPolicy,sandboxVerification,dapEvidence,serverCommand})` with **no `recoveryHooks` option**. `server/workflow-observed.js` forwards its options unchanged; in `server/workflow.js` primary six-role horizontal hooks all check `recoveryHooks?.enableHorizontal...===true`. Hence the normal deployed bootstrap currently uses the legacy branches unless separately demonstrated otherwise: installing new code and a durable volume does not activate its opt-in behavior. This is Source-proven for this main.js bootstrap, not a claim about all external fixture entrypoints. Do not globally turn hooks ON: the opt-in direct continuation interface explicitly prohibits tools, while legacy work uses tool-capable roles, and real semantic equivalence is NOT_VERIFIED. Missing bootstrap activation is a **separate controlled integration / shadow-qualification gate**, not a justification to alter Compose or silently drop tools.

**Critical pre-dispatch budget concern**: deployed `server/adapters/ai-core.js` uses `resolveEffectiveMaxTokens` to cap requested generation by `runtime_context_tokens - OUTPUT_HEADROOM_TOKENS`; existing `OUTPUT_HEADROOM_TOKENS=1000`. At configured 8192 this permits an output `max_tokens` as high as `7192` for some roles **without subtracting the already formatted actual input tokens**. This is *not* a measured 7192-token output or proof of an actual overflow, but it makes the configured cap an insufficient admission guarantee. Effective output cap and reserved input do not by themselves prove `input+output` fits. Preserve present settings until exact served tokenizer/template and slot readback qualify G1 in shadow. Never guess actual input tokens from the old 17,230 request bytes.

**Revised immediate priority**:
1. G0 residual: read-only backend version/loaded GGUF digest/chat-template/actual n_ctx for each slot, current CPU/RAM/OOM events, swap/load and provider timing availability; independent of PR97/103 already completed Host execution. Restore or qualify #16 bootstrap verification without assuming missing local script means rule was applied.
2. Check six-role opt-in eligibility with existing tests and one role-scoped no-mutation, tool-policy-preserving shadow acceptance plan before creating an activation patch. Explicitly measure differences between tool-capable legacy path and direct no-tools continuation interface. Maintain default-off and no changed Compose/env without separate qualification.
3. G1 implement exact actual-template/token-count shadow and explicit non-dispatch refusal in *qualified opt-in* only, verifying valid requests including any Thinking allocation; G2 evidence selection and G3 semantic progress after that.
4. No re-run of the 600s incident solely to reproduce a known timeout, no free-provider tests or 50+50 bulk benchmarks. Measure matched small real work before claiming speed/quality improvements.

**State table:** PR103 Source=PASS; PR103 sampled deployed SHA parity/health/persistent volume=PASS (Composer Host receipt); primary opt-in module wiring tests=PASS in fixtures; **production primary horizontal invocation=NOT_ACTIVE_BY_INSPECTED_BOOTSTRAP**; actual per-slot context, tokenizer and true role semantic completion=UNKNOWN/NOT_VERIFIED. PR101 remains test-only; PR102 unadopted; PR104 docs-only.

### 26.14 G0 real four-model 8192-slot qualification (2026-10-11)

Evidence: [Issue #41 runtime G0](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6108742603) and [#42 chronology](https://github.com/seigo-gace/debug-ai/issues/42#issuecomment-6108742792). All values below are read-only Host snapshot observations, not model benchmark performance or inference calls.

| Backend | Loaded GGUF metadata n_ctx_train | Actual n_ctx, slots | Mem used / 9GiB limit | DebugAI mode |
| --- | ---: | --- | ---: | --- |
| Qwen2.5-Coder Q4_K_M | 131072 | 8192, 1 | 7.92GiB (88%) | Code Scout/Patch Engineer thinking=null |
| Qwen3-8B Q4_K_M | 40960 | 8192, 1 | 8.61GiB (96%) | Causal=false, Diagnoser=true |
| Granite-4.2-8B Q4_K_M | 131072 | 8192, 1 | 6.60GiB (73%) | Researcher=false |
| Ministral-3-8B-Reasoning-2512 Q4_K_M | 262144 | 8192, 1 | 8.01GiB (89%) | Local Reviewer thinking=null |

All four backends are separately **always loaded** llama.cpp:server 0.5.0-dev build11151 bd4f514db, with -c 8192 -t 3 --cache-ram 4096 -np 1 and per-container cgroup limit 9663676416 bytes (9GiB). Runtime /props confirms 8192 slots/context, matching application DEBUG_AI_CORE_CONTEXT_TOKENS=8192 **at this snapshot**. Container OOMKilled=false does not prove zero historical OOM. The router ai-core-llama-swap:v257 has globalConcurrencyLimit=2, responseHeader=600 seconds, unloadTimeout=10; reported peer unloaded is not actual container unload.

All backend POST /tokenize routes returned HTTP200. This does NOT prove the same complete Chat Completions request can be counted through the llama-swap router; /v1/chat/completions/input_tokens remains UNVERIFIED for this installed build. /props reasoning_format=none at idle and remnant /slots deepseek may differ; do not infer actual thinking mode for roles whose setting is null. Actual token counts and template parity of the failed 600-second Diagnoser request remain UNKNOWN.

Prompt cache eviction was observed on all backends under --cache-ram 4096; Qwen3/Granite logs include hundreds of MiB to ~1.1GiB cache entry eviction. Qwen3 memory 96% makes contention plausible, but does not prove the 600s root cause. Do not change memory limit, model/quantization, n_ctx, np, timeout, temperature, Thinking, backend or global concurrency without a separate measured qualified change. ai-core/README.md section12 has documented 6.5GiB/model versus currently deployed 9216m (9GiB); this is an owning ai-core documentation drift, not a request to change Compose.

**G1 Source candidate**: [DebugAI PR105](https://github.com/seigo-gace/debug-ai/pull/105) is stacked directly on deployed product PR103. It implements optional input-token-count Shadow at the exact serialized Chat request body with a 2s bound, default OFF and no inference/Host invocation; deterministic arithmetic and tests. The observed count remains UNQUALIFIED until same endpoint/router/model/template and actual usage parity are verified. It never blocks a normal call or drops mandatory evidence. Retry candidate PR102 is separate and still unadopted.

**Critical product condition**: server/main.js still supplies no recoveryHooks to workflow; the six-role primary horizontal continuation remains OFF in this startup despite PR103 code being deployed. Do not globally enable no-tools continuation and silently remove the tool-capable legacy path. First validate role-by-role semantic completion and the existing permission/effect gates. After G1's route and template qualification, do limited G2 evidence-window / G3 objective progress work without another 600s dogfood or external provider calls.

### 26.15 G1 router 404, four backend counting confirmations and safe candidate (2026-10-11)

**Observed G1 result (read-only, no inference)**: [Issue #41](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6108913953) / [#42](https://github.com/seigo-gace/debug-ai/issues/42#issuecomment-6108914203). Four POST requests to llama-swap Router :18080 at /v1/chat/completions/input_tokens returned HTTP404 (route not registered), whereas the four llama.cpp backend listeners at localhost ports 18081=Granite, 18082=Qwen3, 18083=Ministral, 18084=Qwen2.5 Coder returned HTTP200 with response.input_tokens. Same fixed system+user: Granite35; Qwen3 plain32 / thinking:false36 / thinking:true32; Ministral24; Coder32. The separate raw /tokenize of user text alone was 11 tokens, **not equivalent** to full chat-template counting. No /v1/chat/completions generation request was made.

**Upstream exact-version verification**: mostlygeek/llama-swap [v257 server/server.go](https://github.com/mostlygeek/llama-swap/blob/v257/internal/server/server.go) does not include the exact /v1/chat/completions/input_tokens in its modelPostJSONRoutes (it does include other model POST endpoints); this agrees with the Router404 observation. v257 exposes /upstream/{upstreamPath...} passthrough in server/api.go, but current peer model IDs contain slash sequences such as qwen3//models/... and its FindModelInPath helper builds nonempty slash segments. **Do not assume** this alternative resolves the exact existing model IDs or preserves backend policy without a separate probe. Direct loopback backends, rather than adding proxy infrastructure or guessing an alias, are the narrowly bounded candidate.

**GPT CHAT Source candidate revised in existing PR105**: optional inputTokenShadowRoute=g0_loopback, default remains inputTokenShadow=false and inputTokenShadowRoute=router. A static 4-entry model-ID-to-loopback-port mapping from the measured Host snapshot is only admitted if main model inference URL is exactly http://127.0.0.1:18080. It sends the same existing JSON Chat request body to the model's localhost /v1/chat/completions/input_tokens, but **never sends the Router Bearer API key to a backend**; redirect-following is prohibited and deadline is 2 seconds. Unknown model, runtime/port drift, failed count or unavailable path becomes nullable, nonblocking UNQUALIFIED Shadow. Source unit tests verify allowlist, Thinking false/true body fields, port binding, no credential forwarding and unchanged inference behavior. It does not enable new Host egress, new processes, secrets, frameworks, Work Units, or any provider calls. This branch remains **DRAFT / not deployed / not enabled by normal server/main.js**.

**Acceptance still needed before any production decision**: read back the exact deployed debug-ai container network_mode host, actual backend model identity and local bindings at 18081-18084, confirm that the full role Chat request body with the same chat template kwargs produces counts at the expected backend with no error and no inference. Confirm the count against provider prompt_tokens on a separately authorized small model call, without repeating the historic 600-second work. The current backend 200 short probe proves endpoint availability and Qwen3 +4 Thinking-off delta; it does not establish full-workload template parity, race-free model identity, or latency savings. Do not clamp output, truncate evidence, or turn on the six-role horizontal hooks from this result.

**Ordering and authority**: (1) PR105 same-head Source CI and static review; (2) minimal admitted Host path/identity/count qualification; (3) decide feature activation/measurement with explicit branch and allowed-path verification; (4) only then consider a qualified input admission gate and per-role semantic continuation rollout. PR102 retry and PR103 Product code remain separate. Leave the current healthy production SHA unchanged during this diagnostic phase.

### 26.16 G1 default-off bootstrap and exact Host promotion scope — 2026-10-11

Post-G1 Source owner readback: [PR105](https://github.com/seigo-gace/debug-ai/pull/105) now includes a **default-off, selectable** token-counter route. Its `server/main.js` passes two opt-in environment values to the already existing AI Core adapter, and `compose.yaml` forwards them with defaults `false` and `router`. The `g0_loopback` route is available only if explicitly opted in while the canonical inference URL is **exactly** `http://127.0.0.1:18080`; the unchanged inference endpoint remains the authenticated Router. The counting request alone can target one of the four observed fixed local listener URLs based on the trusted role's existing exact backend model ID; it has a 2-second bound, a no-redirect condition, no Router API key forwarding and no enforcement power. Unknown model/port drift is UNKNOWN, not a guessed count.

Security and runtime gate: This Source implementation **does not enable the feature** in the deployed product. Never use positive counts for production admission until actual model identity, template/Thinking parity and output usage have been verified for the selected backend. A direct backend listener is a local, read-only counting surface. No external address is accepted for `g0_loopback`; the sensitive Router key stays exclusively on the Router inference call. It does not add an independent authority or authorization to bypass the application's inference Router.

Host grant readback at current installed policy from server-core PR97 shows branch `feat/ai-core-input-token-shadow-20261011` is not yet admitted, and **three** changed source paths are not in the old exact grant: `compose.yaml`, `server/main.js`, `server/control/input-token-shadow.js`; existing `server/adapters/ai-core.js` and `server/tests/` are already admitted. Should Host qualification and adoption require PR105 reflection, prepare only this one branch and these three paths as a **new stacked registry Source diff** based on already installed PR97, then have the existing authorized Host writer install and read back private policy. Source CI and a proposed registry edit are not installation or deployment. Do not mutate PR97's installed digest behind the owner's back. No new credential, wildcard, workflow or protected effect.

Quality gate: same-HEAD PR105 full CI including Targeted TGserver Logging must finish PASS before a Host action; one local no-inference full-envelope count via the exact existing product container network namespace is the next verification input, not a 600-second test. For the independent Module PR103, `server/main.js` continues to omit `recoveryHooks`; **G1 Shadow opt-in is not horizontal continuation activation**. Keep the no-tools and tool-enabled contract divergence unmodified until its own evidence-based semantic gate.

Runtime memory and caching are unchanged. Router4-model direct counter results of the short G1 experiment are only endpoint availability, not proof of real job token counts, runtime CPU saving, diagnostics quality, or an exact match for Qwen3 Thinking output.
