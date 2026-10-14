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

### 26.17 G1 Host policy rejection and non-Compose correction — 2026-10-11

**Observed G1 Host Phase A:** [#41 Host attempt](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6109133911), [#42 minutes](https://github.com/seigo-gace/debug-ai/issues/42#issuecomment-6109134099). The installed debug-ai process, using the existing host network, probed full role-compatible Chat envelopes (compiled system, response_format=json_object, per-role Thinking) via direct localhost /v1/chat/completions/input_tokens, *no inference*. ALL 6 returned HTTP200: Code Scout/Coder:698, Causal Scout/Qwen3=false:670, Researcher/Granite:821, Diagnoser/Qwen3=true:883, Patch Engineer/Coder:858, Local Reviewer/Ministral:1089. Direct port and known model mapping matched the proposed G0 four-port static map. This establishes endpoint/model-routing availability for these static role envelopes, **not** exact comparison with prompt_tokens of a production generation request.

**Actual Phase B failure and preservation:** Existing `host-gitops-register-master.sh dlg_master_debugai_v1 admit` rejected previous server-core admission PR104 because its allowed_paths added forbidden `compose.yaml`: `MASTER_PATH_POLICY_INVALID`. The script `scripts/host-gitops-master-internal.sh` path guard rejects `compose*` within allowed_paths; changing Host permission to accommodate this is not permitted. No DebugAI PR105 deployment or Shadow activation occurred. Composer re-synchronized Host canonical policy from the previous installed private registry after the failed attempt; the previously healthy PR103 production remains unchanged. The previous §26.16 three-path admission proposal (including compose.yaml) is **SUPERSEDED** by the below.

**GitHub Source-only correction:** Restore `compose.yaml` in DebugAI [PR105](https://github.com/seigo-gace/debug-ai/pull/105) byte-for-byte to its original PR103 base; replace the corresponding test assertions with proof that Compose has **no** Shadow environment entries and normal server/main.js is default-off. This keeps the existing optional main.js runtime reader available for a separately guarded future activation, but standard deployed Compose has no path for these optional variables: **PR105 deployment alone cannot activate Shadow**. It is an intentionally dormant readiness improvement, not measured active protection. Do not misreport as an operational admission gate.

Update only the stacked existing registry [server-core PR104](https://github.com/G-ACE-inc/server-core/pull/104) by removing `compose.yaml` from newly added allowed_paths. Its delta against previously installed PR97 is now **one exact branch** `feat/ai-core-input-token-shadow-20261011` and **two exact Source paths** `server/main.js`, `server/control/input-token-shadow.js`. Adapter and tests were already permitted. Keep all existing owner/issuer/project/runtime/operation/scope/protected effect constraints and grants unchanged. This is a policy-conformant Source candidate, not installed private Host authority.

**Repeat decision:** Old admit scope will deterministically fail; do not repeat it. Qualify the new PR105 and server-core PR104 exact heads via their own CI, recheck actual PR changed-file and Compose digest parity, and then allow ONLY the existing trusted Host writer to reconcile the new policy Source with the actual current Host canonical/private state and installed digest. Do not change the Host guard, add wildcards, or deploy an unqualified SHA. No new model inference, Groq/Gemini call, or 600s benchmark is necessary to validate a protected path correction.

After safe reflect of product PR105 with Shadow still OFF, enablement requires a **separate**, source/Host-policy-qualified mechanism for passing the flags into the running container; existing Compose does not expose them. That issue must be resolved without modifying protected Compose, weakening its digest guard or claiming a non-existent env injection lane. The work item does **not** complete the full six-role semantic continuation, context admission, or overall debugging product.

### 26.18 G1 Host reflection and G2 integrity hardening — 2026-10-11

**Authoritative G1 Host completion:** [#41 Composer receipt 6109253835](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6109253835) and [#42 6109254010](https://github.com/seigo-gace/debug-ai/issues/42#issuecomment-6109254010) confirm protected private policy admit PASS with digest `9c46de6b5f52cdf8753e19fce5ba1012b818df249a6d1e53e7ad425634aab2e7`, canonical/private equality, seven admitted branches and 54 paths, all effects/Compose digest retained. Product GitOps receipt `gitops_b3fe88e37c38acf605d69106` reflects **exact Source HEAD `b2ebb87c047f593b7b48561e83bdc3a82995f757`** to the live DebugAI Host, HTTP200/healthy, key sampled container/checkout bytes equal and durable volume retained. PR105 and registry PR104 remain GitHub OPEN/unmerged. The long-standing old Host BLOCKED state in §26.12–17 is historical, not Current.

**Current G1 qualification boundary:** Shadow is **OFF** in normal production startup because protected Compose does not inject opt-in env flags. Six real complete-ish per-role Chat request bodies to local backend **count-only** endpoints were HTTP200 (Code Scout698, Causal670, Researcher821, Diagnoser883, Patch858, Local Reviewer1089); this does not validate counter agreement with actual production `prompt_tokens` or enforce admission. The still-unverified horizontal continuation opt-in remains OFF. No cache/timeout/quantization/Thinking changes or new inferencing calls were authorized by this Host reflection.

**Independent G2 Source candidate:** [DebugAI PR106](https://github.com/seigo-gace/debug-ai/pull/106), based on the now-reflected PR105 HEAD, edits only existing `server/control/active-evidence-window.js` and its test. Existing `makeEvidenceProjection()` generates content-addressed `projection_id` and `projection_digest` from bounded payload. Existing `buildActiveEvidenceWindow()` selected/deduplicated records without checking that declared digest still matched payload, could suppress conflicting identical projection IDs, and allowed a blank required excerpt. PR106 verifies runtime versioned projection integrity before selection/deduplication, blocks duplicate mismatches, rejects empty mandatory excerpts, and tests valid/tampered/counter-evidence/legacy cases. Unversioned legacy test fixtures remain allowed but are **not** authenticated evidence. This is evidence *consistency* and required-input completeness, not a proof that a source record is true or that a model reached semantic completion.

**Source release boundary:** PR106 is DRAFT and **not installed/reflected**. Exact-head CI and existing tool-loop integration regression required first. Its proposed branch `fix/evidence-window-integrity-20261011` and changed `server/control/active-evidence-window.js` are not included in currently installed DebugAI Host registry. If the Source candidate qualifies for activation, only the existing trusted registry writer may prepare/register that one branch+path and install/readback policy; no new workflow/MCP/Token or modification of protected Compose. Do not deploy PR106 merely because it follows PR105's already deployed head. Independently inspect the Codex-owned continuation logic and full DebugAI semantic acceptance *without* overwriting its Product PR103 Source.

**Priority:** G2 evidence integrity Source/test qualification can progress now; G1 real counter usage parity and non-Compose activation remain a separate *later* guarded option. Then G3 objective per-role semantic progress and bounded real debugging, preserving fallback/evidence rehydration and authority gates. No 600-second replay or free-provider calls are necessary to validate deterministic G2 checks.

### 26.20 G3 Codex continuation — deterministic role-owned acceptance, 2026-10-11 JST

Master transferred PR107 to Codex for the G3 continuation. Fresh Project item
PVTI_lAHODOQFoM4BEJIIzg-sWS8 names Codex sole product mutation owner. Parent
`/home/admin1/projects/debug-ai` is the deployed G2 SHA68aa86c; an isolated owned
worktree `.worktrees/g3-semantic` reuses PR107's existing branch. G2 is already a
PR103 descendant: no unconditional PR103/107 merge or rewrite is needed. Existing
PR103 continuation/store/RunAuthority files remain unchanged. This section adopts
only bounded G3 source behavior; it does not activate the primary horizontal path.

**Gap and decision.** Existing continuation admits paraphrased `remaining_work`
strings with admitted Evidence IDs; a changed digest is not verified work. PR107's
qualified Progress Controller/Tool Loop plumbing is reused, not reimplemented.
Extend the existing role-output-validator with fixed, role-specific acceptance
criteria supplied by the trusted caller from independently executed observations.
Never derive criteria or their expected outcome from the model response, a new
Evidence ID, or untrusted repository instructions. Evidence Registry hashes prove
consistency, not external truth: the independent criterion producer is an explicit
trust boundary. Missing criteria in requested G3 mode fail before model dispatch.

| Role | Accepted independent obligation |
| --- | --- |
| Code Scout | exact source path + SHA256 inspected; result retains that path |
| Causal Scout | observed supported/refuted edge with from/to/state and retained alternatives; same structured edge and Evidence in candidates |
| Researcher | independently verified source retrieval, exact version and Evidence reference |
| Diagnoser | independently observed hypothesis state/falsification condition and supporting or counter-Evidence; canonical retained/rejected hypothesis |
| Patch Engineer | independently executed PASS check, candidate hash/source revision and exact candidate operations; no apply |
| Local Reviewer | independently executed review/test obligation, candidate hash/post-apply revision/apply receipt/name/status; matching verdict |

Criteria bind fixed IDs, source references, observations, Evidence IDs and canonical
role output expectations to the original input binding. Intermediate output contains
`verified_work:[{criterion_id,evidence_refs}]` and an exactly enumerated
`remaining_work` array. The caller reconstructs a verified snapshot using the
existing qualified Progress Controller; model-supplied snapshots are discarded.
Semantic objective identity excludes criterion/Evidence/Work/Effect ID churn and
prose. Duplicate semantics/markers, missing or unrelated Evidence, corrupt records,
false remaining sets, changed policy and no-op/paraphrase-only turns fail closed.
No schema migration: the existing bounded progress object carries the optional
qualification snapshot, within the existing v1 immutable work-item record.

COMPLETE requires canonical enforced role output validation, every fixed criterion
and Evidence marker, plus equality to independently expected role outcomes.
Terminal results are revalidated on restart; state/criterion changes reject reuse.
Existing primary six-role entry hooks consume caller criteria when opted in, and
the dedicated Diagnoser route reuses that same checker instead of duplicating it.
This is acceptance of an independently fixed bounded obligation, **not general
proof of arbitrary natural-language debugging truth**. Ordinary production tasks
still require qualified independent criteria/oracles; no model self-certification.

Tool Loop reuses the existing durable result hook and qualified mode. A verified
source.read or complete evidence.read can derive a criterion objective only with
its committed Effect reference and matching admitted source/Evidence content.
Transient lookup is reconstructed from existing observations on resume; no second
ledger or state authority. Same task binding is retained in the controller snapshot.
Final role output also passes the same completion checker in qualified mode,
including no-tool paths. Legacy default and tool permissions remain unchanged.

**Alternatives rejected:** a new progress framework/orchestrator; arbitrary caller
ID strings as proof; new evidence schemas or model-based judges; removal of tools;
global bootstrap activation; inventing trusted causal/candidate evidence from a
model's own narrative. Exact expected result matching is deliberately conservative;
unqualified task equivalence stays UNKNOWN, rather than guessed from synonyms.

**Validation and remaining gates.** Six-role deterministic positive/negative tests,
actual owning source.read integration and three independent native processes verify
CONTINUE -> restart -> COMPLETE -> replay with zero repeated model calls. Existing
Approval/apply/retest/review/Strict Completion and Effect Ledger regressions remain
mandatory. Test model fixtures and independent test observations are clearly
separated from real-model debugging. No Groq/Gemini calls, 600s runs, 100-task suite,
model/provider/Thinking/Token Shadow/Compose change or new workflow/MCP/token.

At Fresh Host readback PR107 branch and two control paths (progress-controller.js,
tool-loop.js) are not installed in the existing delegation. Source tests/CI do not
permit their reflection. Only the existing authorized policy owner/writer can
reconcile the exact branch+paths, preserving other owners and protected effects,
then issue the existing exact-SHA receipt. Current G2 stays live until this separate
Host gate passes. G3 production acceptance additionally needs independent criteria
for actual six-role debugging and bounded real-model Runtime evidence; Source
fixtures, API health and CI alone do not satisfy it. Rollback omits the optional
criteria/qualification settings; saved G3 items cannot downgrade in place, and
approved effects are never reapplied automatically.

Expected role answers and observed acceptance predicates remain outside the model
prompt; only criterion IDs/types/Evidence source references are exposed. A model
must produce the original role output from Evidence, not copy a supplied answer.
The independent checker keeps exact conservative expectations as a hidden oracle.
G3 no-progress/invalid-observation errors are explicitly nonretryable, preserving
the existing workflow failure classifier instead of consuming retry steps.

Fresh Review holdout: an extra FACT with a valid known Evidence ID can pass the
canonical shape/binding validator while asserting an unrelated conclusion. G3
therefore rejects extra final fields outside the independent expected role output;
known-ID citation is not semantic support. Six additional holdouts first prove the
canonical output validator accepts the well-shaped artifact, then prove G3 rejects
it. Non-Researcher observation obligations require LOCAL_RUNTIME authority.

Bounded native/local Coder Dogfood on owning Source at8e275c7: first CONTINUE
accepted in11.397s (3096prompt/81completion, prompt_eval160.101ms,
decode11153.761ms, cache3095hit/1miss); second call45005ms AI_CORE_TIMEOUT,
no complete result. This is one source-inspection step, not actual six-role repair.
The probe's disposable runtime was not a production Run; free-provider calls0.
Early harness attempts lacked a writable result path under cap-drop/root and yielded
no recoverable role telemetry; those are NOT acceptance evidence. The harness was
corrected to uid1000 with a pre-call write check. No unchanged45s/600s retry is
justified. Prompt inspection independently found the saved controller/history
snapshot being sent to the model. G3 now projects only validated work markers,
exact remaining IDs and Evidence references; full authoritative qualification
state stays durable, and all original Evidence bodies remain available. This
removes irrelevant accounting from the prompt without claiming it caused the
observed timeout or changing context/output/model/runtime defaults.

G3 direct continuation calls now reuse the existing run-scoped AI invocation observer, including the legacy Diagnoser adapter. A failed call records its invocation ID, role, terminal failure and sanitized telemetry without committing semantic progress. Missing provider metrics remain UNKNOWN; this does not establish the cause of a model timeout or relax its budget. Six deterministic timeout regressions cover this connection without provider requests.

### 26.21 G3 resume prefix and probe/product budget separation — 2026-10-12 JST

**FACT:** the existing observed native run `run_mv3yskzt_c8b4107afe`
committed CONTINUE at revision1, then the probe aborted resume after45s.
The harness explicitly supplies both `timeoutMsOverride:45000` and an absolute
45s deadline; this is not the product role deadline. Retained Coder logs for
2026-10-11 15:15–15:18 UTC independently identify tasks55994/56076:
initial slot prefix similarity1.000, resumed0.431 (retained0.427), resume launch
15:15:16.719, cancellation15:16:01.635, release15:17:02.179. The failure has no
prompt-eval/decode timing line or complete output: those metrics remain UNKNOWN.
Release after cancellation does not prove a completed result or a particular
backend phase. Prior measured uncached Coder prompt evaluation costs roughly
55–68ms/token; do not assume a45s cold probe can process the same input that
completed in14s with3109 cached prompt tokens.

**Source defect and adopted bounded improvement:** G3 serialized changing `step`
and `previous_progress` before immutable evidence/criteria. Existing workflow now
serializes fixed task, registered Evidence IDs/content and public criterion
references first, with step/progress last. No field, evidence byte, hidden oracle,
validator, input binding, Role/model/Thinking default or timeout is changed.
Legacy unqualified prompt layout remains compatible. No second prompt/state/cache
owner is introduced. Cache is disposable acceleration, never accepted Evidence
or durable progress. Six independent Role regressions first fail against the old
ordering, then prove byte-identical fixed prefix across a fresh workflow restart,
correct changing suffix and completed replay with zero model calls. Focused62/62;
canonical882/882, fail0/skip0, including real TS7, passed in an offline disposable
container. A first local full run traversed private probe state and lacked the
explicit TS7 switch (880 pass/1 environment failure/1 skip); rerunning with an
empty disposable `.debugai-input` mount and the real TS7 switch passed, without
changing tests or permissions on saved checkpoints.

**Alternatives rejected:** increasing production deadlines, lowering output
allowance/evidence coverage, altering model/cache state, dropping semantic
validation, repeatedly rerunning the same45s probe or enabling horizontal
production by default. One measured read-only native probe may use an explicitly
recorded finite caller budget derived from uncached prefill plus canonical output
cost, bounded below the unchanged product role ceiling. A changed probe budget
must be reported as a separate condition, never a same-budget speed improvement.
No free-provider review, bulk benchmark, blind retry or600s experiment.

**Fresh Host readback supersedes §26.20's old denial:** canonical checkout is
bb70d0654056eed555cfdb424ce41ec4e4dfdb1d and healthy; existing mapping validator
passes and installed branch plus both previously denied control paths now pass.
Installed policy SHA256 is
e85e3f7da61722b8b4ba5141df76ad68b3538404bea22034017c22eb729073d9.
This executor did not write the registry/policy. Every subsequent reflection
still requires fresh complete changed-path/remote-SHA/CI admission and the existing
single-use receipt. Current input-order change is not reflected by this readback.

**Acceptance/rollback:** unchanged integrity/no-progress/unsupported-COMPLETE
negatives and existing approved apply/retest/Strict Completion must pass. Native
real-model resume and current-source Host reflection remain separate gates until
measured. Reverting only the G3 JSON field order restores old wire layout without
checkpoint migration; failed/partial model output never advances revision. This
bounded source inspection does not establish real six-role debugging completion.

#### 26.21 measured native resume and failure diagnostics

At source576bad420b10f5e0be7d2e19162750e4812d8e35, one150s-bound native
resume of the SAME saved run returned in125,266ms. Measured prompt3166,
completion114, prompt_eval105,274.740ms, decode17,661.164ms, cache1361hit/1805miss,
finish_reason=stop, transport attempts1. The new ordering necessarily differs
from the OLD checkpoint probe's cached layout; this is a first-call cold-transition
measurement, not an initial→resume cache-speed comparison. It confirms the45s
probe was shorter than this measured uncached prefill. Model final output was
rejected as MODEL_FINAL_REJECTED; original CONTINUE/revision1 remains intact.
No incomplete or unsupported result is admitted. This establishes response and
checkpoint preservation, NOT successful semantic completion or source-read truth
beyond the existing independent observation.

The real dogfood exposed an actionable observation gap: the existing semantic
completion checker returns only false, so the caller cannot distinguish missing
markers, unsupported extra fields or an outcome mismatch. Extend that SAME checker
with `assessCompletion` and retain `validateCompletion` as its boolean projection;
no alternative validator/state authority. The checks and required outcomes stay
unchanged. On rejected G3 final output the existing workflow records
`debugai.role-validation/v1` in RuntimeEvidence and the existing TGserver log sink.
Only role, stage, valid=false and an authored reason enum are retained:
FORBIDDEN_EFFECT, ROLE_OUTPUT_INVALID, VERIFIED_WORK_INVALID, CRITERIA_INCOMPLETE,
UNSUPPORTED_FIELD or OUTCOME_MISMATCH. No rejected model text, raw error, extra
field names/values, hidden oracle, expected answer or Evidence content is logged.
Six fail-first Role cases and category checks establish unchanged rejection,
zero progress commit and sanitized local/TGserver routing. A diagnostic real
call must be separately bounded and justified by the newly observable failure;
never rerun a known failure after its category is obtained without changing the
causal input. Rollback removes only diagnostics; the boolean gate remains required.

At05b770acb113c97d7562aa27f1a96f61511a4c23, exactly one newly instrumented,
45s-bound diagnostic resume returned in16,431ms (prefill142.618ms, decode16,221.126ms,
cache3165hit/1miss,3166prompt/114completion). The checker records
VERIFIED_WORK_INVALID; saved CONTINUE/revision1 is unchanged. This proves a
rejected marker contract, not the precise omitted/malformed field or a causal
model defect. No raw model response was saved. New source therefore clarifies the
existing wire contract: COMPLETE `result.verified_work` is the same array of
`{criterion_id,evidence_refs}` objects as intermediate progress; retain the admitted
marker references inside `result`, never substitute ID strings or move markers
outside the result. No expected role answer is supplied. Six fail-first prompt
regressions cover all Roles, preserving identical initial/resume system bytes.
This changes the causal model input before any further bounded acceptance call;
no validation/assertion is relaxed. The observed16s warm vs125s cold is a cache
condition comparison, not proof of full debugging speed or semantic correctness.

### 26.22 Deterministic recovery of omitted final proof markers — 2026-10-12 JST

**Dogfood finding:** atb33808cda09459e69047dd7aac17dca77aeb1161, explicit final
marker instructions still yielded VERIFIED_WORK_INVALID after143.741s
(prefill122.751s/decode17.792s,3220prompt/114completion). One newly instrumented
warm45s diagnostic,16.610s, retained only fixed booleans/counts about the parsed
contract: status COMPLETE, result present, `result.verified_work` absent.
No model text, unknown field names/values, hidden answer or raw error was saved.
All rejected attempts preserved the original run's CONTINUE/revision1.

**Adopted nonregressing alternative:** restore omitted final markers ONLY from
ALL already independently qualified obligations in the existing SAME task-bound
checkpoint. This is trusted runtime proof recovery, never a model output promoted
into evidence. Reuse the canonical evaluator/Progress Controller and existing
continuation context. `restoreCompletionMarkers` requires every fixed criterion,
matching source/Evidence records, the exact qualification binding/policy, qualified
objective IDs/count, no unfinished work and exact Evidence references. Missing,
partial, corrupt, stale or unqualified state returns the original unmodified
result and remains rejected by the existing completion checker. A model-supplied
marker field (including null/empty/forged) is NEVER overwritten. The server only
adds omitted proof markers; it never changes canonical role fields, expected
outcomes, unsupported fields or effect claims. The same enforced shape/Evidence,
all-criteria and independent expected-outcome checks still decide completion.
Fresh and restored terminal results retain the existing complete proof shape.
No checkpoint migration, second validator/ledger, added permission, primary-path
activation or automatic apply. Tool Loop behavior is unchanged.

**Why:** asking a small model to retranscribe already committed proof adds a
format failure without adding independent truth. Restoring complete validated
proof deterministically preserves the stronger external outcome checks. Rejected
alternatives: accept marker-free first-call COMPLETE, infer unknown work from
model prose, fill expected role answers, silently repair supplied wrong markers,
or relax false-FACT/unsupported-field/Source/Approval/Review gates. Six fail-first
workflow/restart/replay positives plus six corrupt/stale/unfinished/supplied-proof
negative groups qualify the change. Actual-model success is separately measured;
fixture acceptance is not real debugging. Rollback removes restoration only;
normalized saved complete results still contain all originally required markers.

**Effective Host boundary correction:** exactb33808c has6/6 CI SUCCESS, but
existing guarded requestgitops_fbd76bf8bf467f1b1a22a7fe fails
MASTER_REGISTRY_READBACK_MISMATCH before deployment. Source/default-registry
preflight differed from the real systemd user-manager environment:
DEBUG_AI_MASTER_REGISTRY points to the existing qualified registry
`fd1657f7c8b5b21a78a812dc0040eb68a83d2f74.json`. Neither existing qualified snapshot
(fd1657f7 or3e84bc06) matches the installed policye85e3f7d. The default local
registry does match, but is another owner's dirty source; it is NOT substituted
as a trusted runtime credential. No policy/grant/manager-environment change or
retry of the same refused deployment. Canonical live revision remainsbb70d06.
Existing trusted registry owner must qualify/pin a matching snapshot through its
approved lane, preserving scope/effects. Only then a fresh exact-SHA receipt and
normal reflection. This blocks that runtime operation, not independent source
work or native disposable read-only qualification.

#### 26.22 real native acceptance and existing qualified registry pin

Actual engineeeadc29983dc820b47d48432ef76e4d9a6e3e486 resumed the ORIGINAL
run_mv3yskzt_c8b4107afe in a fresh native process under45s bound: COMPLETE,
17,798ms model wall,3220prompt/114completion,132.985ms prefill/17,591.983ms decode,
3219cache-hit/1miss. Restored trusted markers plus unchanged canonical/independent
outcome checks accepted result; durable status COMPLETE/revision2. Another fresh
process restored COMPLETE/revision2 in29ms with zero model calls, proving no
reexecution of completed work. This is one bounded owning-source inspection with
independent file/hash observation, not six-role diagnosis/repair E2E. Existing
six-role holdouts/full suite901/901 (fail0/skip0/real TS7) pass; exacteeadc29 CI6/6
SUCCESS. No free-provider call, source apply or horizontal production activation.

The rejected reflection exposed stale runtime configuration, not a need to grant
new permissions. Existing server-core PR122 exact
9d3554550c25d3e2fb7efac317a311c7cc1cf0a7 is CI3/3 SUCCESS and its GitHub registry
blob/DebugAI entry is byte/structure-verified against installed policye85e3f7d.
All non-DebugAI registry content equals previously pinnedfd1657f7; only its
already-installed allowed branch/path sets differ. Preserve other owner's dirty
server-core source and the entire installed policy. Under Master's delegated
routine technical authority, copied ONLY that existing qualified GitHub snapshot
into the existing trusted qualified-registry directory (owner check,0600,
exclusive/no-symlink write, exact Git blob identity), verified full mapping, then
repointed the existing user-manager DEBUG_AI_MASTER_REGISTRY pin to it. Effective
readback matches9d355455; existing branch/path validators pass. No grant, issuer,
Secret, policy, service/Compose, workflow, token or unrelated registry entry change.
This fixes the pinned readback mismatch without substituting unqualified local
source or bypassing admission. Snapshot provenance remains that existing PR.
Old failed operation is terminal and is never replayed; the next deployment uses
a new exact-SHA request/single-use receipt through the normal Host validator.

Rollback for the pin is the previousfd1657f7 path through the same user-manager
setting, with the explicit consequence that G3 again fails readback against the
newer installed policy. This is a runtime manager pin, not a claim of permanent
source/config promotion across manager restarts. Reverify effective pin on future
reflect/resume. Whole-product acceptance and six-role actual repair remain pending.

### 26.23 Unicode search excerpts and real-source dogfood — 2026-10-12

Observed defect at production/source c9b2f14: `source.search` finds an ASCII marker
following 900 U+0130 characters, yet returns an empty original-source excerpt.
Default lowercasing expands that prefix, so an index in the lowered string is
incorrectly applied to the original string. ASCII control passes; independent
astral-plus-expanding-prefix and case-expanded-query regressions fail. The hit
and source SHA are genuine, but the supplied excerpt cannot support investigation.

Adopted requirement: preserve the current lowercase-substring matching semantics,
original source case/bytes and SHA, one hit per file, bounded read/search and
coverage receipts. Convert a matched lowercase offset back to its original UTF-16
source position when casing changes length; leave equal-length matches on the
existing cheap path. Do not lowercase the returned excerpt, replace matching with
locale-dependent/regex semantics, weaken truncation disclosure or broaden reads.
No new Tool, Validator, state owner, provider/model or production flag is needed.
Rollback is the existing source-qualified guarded reflection of the prior source.

Dogfood uses the existing live workflow, current assigned models and RunAuthority.
The qualification input is the twelve exact repository files in the static import
closure of the affected module, plus an independent, fixed dependency-free Node
regression oracle. This is a source projection inside the existing owned parent,
not a clone, Git repository or new registered project. Its manifest binds every
original file to c9b2f14 and SHA256; the owning production source is never modified
by generated candidates. The existing sandbox materializes and runs candidates;
approval and fresh review remain required before any application. Full-repository
external dependency admission and full-product completion are separate, unproven
claims. Preserve actual failure, run ID, tool/model observations, candidate result
and limitations in existing Current/minutes rather than fabricating a fixture PASS
or expected diagnosis as model evidence.

### 26.24 Local Causal Scout evidence projections with authenticated re-read

The real-source dogfood run_mv5agtgf_96b706c70a stopped at a Causal Scout deadline:
249.996s queue wait then600.007s upstream wait, no response/body telemetry. Its
17,640-byte request contains full initial source/reproduction records even though
this role reasons from observations and may need only selected details. The exact
backend cause remains UNKNOWN; a smaller payload is not proven timeout recovery.

Reuse the existing Evidence Projection, role-local Evidence Context and read-only
Tool Loop. For the existing non-horizontal LOCAL_REPRODUCTION path only, large initial Causal Scout records become
700-character projections; smaller records, literal task, failure/requirements,
initial scope and registered IDs remain intact. Projections disclose omissions and
retain parent ID/digest. The full canonical records seed that same role-local
context independently of the serialized model prompt. Existing evidence.read can
recover omitted source/counter-evidence within its existing bound and admission.
Code Scout and all other role inputs and open-investigation inputs are unchanged.
No information is promoted from a pointer into FACT, and a projection alone does
not prove sufficiency or a cause. Retention/RunAuthority remain the existing owners.

Only runtime-admitted baseEvidenceIds may seed that context. Canonical evidence
integrity, duplicate conflicts, role/Skill/tool admission and response validation
still apply. Caller payload cannot grant seed authority; the workflow passes its
own registered records. Defaults keep existing callers compatible. Full records
are still available downstream and in durable context; no expected answer, new
Reviewer, endpoint, state store or provider/model/budget change is introduced.

Rejected alternatives: truncating raw records without disclosed/re-readable parents,
discarding failed tests/counter-evidence, extending timeouts, lowering generation
ceilings, or blindly retrying the unchanged failed request. Qualification must prove
actual omitted-evidence re-read through the Tool Loop, admission/tamper negatives,
unchanged small/open inputs and restart/reuse. Measure payload size separately from
latency/semantic success. Only a qualified changed-input same-run resume can supply
runtime outcome; rollback reverts this projection/seed wiring through the existing
exact-head guarded lane. Unicode search qualification at880c8ee remains separate.

Deterministic qualification: focused38/38; exact before-source38 tests34pass4fail,
all four new re-read/seed/integration cases fail without the wiring. Replaying the
same real request plus actual saved sandbox reproduction through a no-model
capture gives causal user10120→7280bytes (-2840/-28.1%). This is payload size,
not measured tokens, speed or successful real diagnosis. Tool observation/read
bounds remain in force: evidence beyond those bounds stays explicitly PARTIAL
and UNKNOWN, even though its complete authenticated record remains in context.


Host scope reconciliation: operationgitops_5bfaf591d98c1f5757928c4f was rejected
DELEGATION_CHANGED_PATH_FORBIDDEN before receipt/effects because the initial diff
modified read-only-tool-runtime.js. Inspection finds an already exported, verified
addEvidenceToContext API in both runtime implementations. Reuse it inside the
existing Tool Loop after context creation, with the existing admitted-ID filter;
restore both runtime files to their preceding qualified bytes. This reduces the
actual code diff and constructor coupling while preserving the same re-read gates.
No policy/registry/grant write or receipt bypass; the rejected history remains.
An unavailable context/seeding API rejects before dispatch rather than silently
losing compacted evidence. Final consolidated Source requires its own exactCI and
normal guarded reflection; earlier-head proof is not inherited.


Final existing-API qualification: real880c8ee baseline39tests36pass3fail; current
focused42/42pass and full canonical910/910pass,fail0skip0/realTS7. Both runtime
implementation files are byte-identical to880c8ee; only existing Tool Loop/workflow
wiring changes code. The entire consolidated seven-path diff matches the unchanged
installed Host policy. An earlier full check had one SIGKILL/restart test failure;
the complete stable-source rerun passes without altering that test or its gates.
The failed run remains recorded; do not treat it as a qualified pass.

Master requested a clean checkpoint and pause on2026-10-12. Finish Source/CI and
admitted reflection readback, then pause without restarting the real model run.
Native timeout recovery/diagnosis/candidate/full repair remains NOT_PROVEN. Resume
only on a later Master continuation, fresh Current/pin/HEAD/runtime readback, with
original run_mv5agtgf_96b706c70a and the materially changed projection input. No
background developer or new model run is launched to circumvent the pause.


---

## 27. DebugAI product-wide capability-preserving efficiency design (PROPOSED, 2026-10-14)

**Status:** DESIGN-ONLY / NOT ADOPTED / NOT IMPLEMENTED / NOT DEPLOYED. This section is a proposed design delta to the existing product architecture, based on the PR #107 source tree and the product purpose in §§1–4, not a direction to change runtime settings. The Master accepted the design-first investigation sequence and explicitly requires no capability degradation. No inference-engine changes, model reassignment, Host actions, new token/Workflow/MCP, permission change or implementation work is authorized by this section alone. When this PR's base moves, revalidate Current and owning source before writing code.

### 27.1 Product result and optimization objective

DebugAI is a **six-role, evidence-bound debugging execution sub-agent**. It must execute actual debugging, not just generate a plausible explanation: reproduce/inspect a real defect; localize affected code and collect evidence; form and falsify causal hypotheses; research when needed; reach an evidence-grounded diagnosis; get the required external hypothesis review; produce a scoped patch candidate; retain the explicit candidate-identity approval boundary; apply only through the established authority; run baseline/candidate/retest/invariants; independently review; complete through the real Strict Completion conjunction; and durably recover from interruption without redoing verified effects. Keep the current two permitted external review points and FREE-provider quota control.

Optimize **verified correct completed work per end-to-end elapsed time and resource consumed**, with a lexicographic hierarchy, NOT "lowest CPU at any cost":

1. Hard invariants: no privilege expansion; no new false PASS or false skip; required Role/Skill/Tool/Evidence/Counter-evidence/Source SHA/approval/verification/Reviewer/Strict Completion functionality unchanged; reject stale or absent evidence; no data loss under restart; remain correct for Python/JS/Unicode/boundary/hypothesis cases.
2. Measured diagnostic, candidate, test and final outcome quality must be non-inferior for each role/class and full workflow, including independent holdouts; neither a short response nor a JSON-shaped response constitutes success.
3. Among quality-safe candidates, improve the **total verified completion rate, full-run p50/p95, CPU-seconds per verified run, weighted peak memory, unnecessary model input/prefill and sandbox disk I/O**, without turning UNKNOWN into a measured gain.
4. Prefer changes that remove waste at its source over speculative model replacement, loss of reasoning, shorter output ceilings, or indiscriminate parallelism. Measure model cold-start/cache churn and cross-product interference before changing dispatch policy.

No blanket token, RAM, CPU, timeout, evidence size, tool round or role count reductions are proposed. Current role Model Profile ceiling is a *capability limit*, not an intended generation target; retain qualified runtime n_ctx clamps (§26). Existing 4 models and 6 roles remain authoritative for compatibility. PR #108's three-model alternative is a plan, not an accepted reallocation.

### 27.2 Traceability to actual baseline and evidence class

- Current code baseline: PR #107 `test/g3-semantic-progress-counterexample-20261011` at creation HEAD `302e4cae37c8d97d1decae6864d0f01565026f6c`. This is **13 commits ahead** of the earlier `8627d1d...` source used by the incomplete PR #109 module merge experiment. Do not integrate PR #109's older `*-budget.js` values or overwrite current semantic Tool/Evidence/continuation code. Keep PR #109 in Draft and rebase needed *minimal role-only delta* against PR #107.
- Legacy standalone benchmark: 50 investigation cases: DONE 21/50, timeout 18, format contract 9, budget 1, HTTP 1. Independently evaluated DONE outputs PASS 14, PARTIAL 5, FAIL 2. Code candidate 60-case semantic PASS 25/60, semantic misses 26, format/contract FAIL 9. These are **different cohorts/conditions** and NOT full product completion percentages. Keep existing holdouts and native repository E2E separate.
- Real run `run_mv5agtgf_96b706c70a`: Code Scout ~250.013s (reported 233.090s prefill and 13.323s decode, 4771 input / 75 output tokens, Tool calls 0); Causal Scout ~249.996s global queue then ~600.007s upstream timeout; task BLOCKED before Diagnoser/Candidate/Retest/Review/Strict Completion. The causal model's internal time distribution/timeout cause is UNKNOWN, so no inference that context reduction or parallelism would definitely fix it.
- Previous local Causal input projection 10120→7280 characters (28.1% reduction) is NOT measured Token, Runtime Latency or Semantic gain. Historical four→two model memory reclamation belongs to AI Core host memory, **not measured DebugAI Node RSS**. PR #108 `runtime_memory_savings=NOT_VERIFIED`.
- App/Sidecar/Sandbox CPU/RSS/cgroup quotas, event-loop delay, copy/digest bytes, Core resident→request cache-hit outcomes, retained Evidence sizes and cross-project resource interference remain **UNMEASURED**. Treat source code *limits* (Snapshot 256MiB, RuntimeEvidence default 24h/256MiB, Context view 12 items/12000 chars, compression recent5/historical15/85%) as configuration/guard rails, not observed consumption or certified optimal thresholds.

### 27.3 Owners and architecture: no new resource manager

| Owner | Keep / use | Product optimization boundary |
| --- | --- | --- |
| AI Core, shared across products | physical model resident/start/stop, common Lease, authenticated 4 Gate API and Model Registry, global Admission/fairness, CPU/RAM/cgroup pressure, llama.cpp slots/KV/restart, prompt processing runtime | DebugAI must never independently stop/start models, allocate physical cores, reproduce Lease, mutate n_ctx or cache memory/slots. |
| DebugAI RunAuthority + existing Workflow | six-role task dependencies, stage cursor, durable saved evidence, cancellation, effect identity, project revisions, approved mutation and strict completion | Narrow product-owned workload shaping and observability **inside existing owners**, not a second orchestrator or state store. |
| Existing AI Core Adapter | role→model and API transport, queue/deadline/abort, model-specific effective token admission and timing telemetry | Extend consumer Route/Profile negotiation only for new Gate contract, preserving previous `call()/callPrepared()`, Stage A legacy and not bypassing AI Core Admission. |
| Existing Tool Loop / Evidence Registry / Context compression | role/tool admission, full canonical evidence, projection/active window, admitted `evidence.read`, replay-safe Tool effects and progress | Build task-relevant **prompt views** and avoid unnecessary re-sending; do not compact authoritative Evidence, facts, disconfirming data or full exact patches. |
| Existing Sandbox/Sidecar/Verification | snapshot isolation/hash, language checks, candidate test/retest, guard/approval and output receipts | Meter and bound product-owned CPU/IO jobs; do not suppress necessary tests, parallelize dependent checks blindly or assume a product's remaining CPU quota is available. |
| Existing RuntimeEvidence/TGserver | authenticated trace and long-term log/evidence policy | Correlate existing telemetry with new **missing** Node/sidecar/tool/sandbox resource counters; no duplicate central telemetry store. |

The model cannot be optimized in isolation from DebugAI's file scanning, hashing, repeated snapshot materialization, Test/Build Sidecar, JSON serialization, queue idle time and rehydration cost. However these are candidate bottlenecks inferred from code, **not measured waste**; profile first.

### 27.4 Execution demand first: use the existing six-role work

**D0 Mandatory-work guarantee.** Maintain Code Scout, Causal Scout, Researcher, Diagnoser, Patch Engineer and independent Local Reviewer roles, with their present model profiles/Thinking modes, skills, entry/exit criteria, handoff, output and failure contracts. Do not skip a mandatory review, evidence obligation or verification because a heuristic "looks enough" or cache suggests so. Skip only a proven-unnecessary optional search, duplicate Tool effect or replayed completed work under the existing Role/Search Gate shadow conditions. Compare false-skip negatives before enablement. A Code Scout that produced no inspected source evidence must not pass as completed localization even if a short text was generated.

**D1 Evidence-driven workset planner (incremental, existing Tool Loop).** Reuse `active-evidence-window.js`, `context-compression.js`, `evidence-projection.js`, `evidence.read`, deterministic search coverage, RoleCheckpoint and current requested/remaining obligations. Before a model call construct a signed/bound **view** containing: exact task and prohibited mutations, acceptance predicates, Source snapshot and model/role policy, fixed evidence IDs and contradictory evidence, current unmet criteria, only relevant full excerpts, immutable hashes for compacted entries and explicit omissions. Rehydrate *required* omitted evidence by admitted bounded Tool read. If a required passage is absent, block that dependency instead of making up a fact. Observe actual input tokens/prefill/cache miss and how many extra reads were needed; "less prompt bytes" alone is insufficient.

**D2 Duplicate work elimination (existing durable ledger).** Before new source.search/read, TGserver/official lookup, model step, snapshot/hash or candidate retest, decide from **the same RunAuthority and content/source binding** whether the verified result is still reusable, including age, scope, model/policy and dependency identity. A stale/partial/corrupt/UNKNOWN result is never treated as COMPLETE; re-run or block according to existing rules. Do not create a second general cache or share cross-product source/proprietary prompts; record avoided *actually duplicated* work with a verifiable receipt.

**D3 Model-aware business plan — only after D1/D2 measured.** The current Workflow can issue Code Scout/Causal Scout in parallel but current Adapter `queueTail` serializes across physical models. Compare Baseline A global serial, Candidate B bounded *different-model*, dependency-eligible Scout submission and Candidate C dependency-aware reordering of only independent stages. The candidate must respect the same fixed roles, mandatory research/review/test and Qwen3/Coder shared physical model identity; it does not schedule AI Core residents, prewarm models or claim an Handoff ticket without the Core contract. If cold switching, cache loss, prompt damage, starvation, CPU pressure, late replies or correctness regress, retain A. No general concurrency activation before isolated same-runtime benchmarks.

### 27.5 Node App memory and CPU: new measurements, minimal modifications

**First measure by stage**, using existing `RuntimeEvidence` records: `process.cpuUsage()` delta (user/system CPU time), `process.memoryUsage.rss()` and `process.memoryUsage()` with `heapUsed`, `external`, `arrayBuffers`, Node `performance.eventLoopUtilization`, event-loop delay; process/Sidecar and descendants/isolated Sandbox separately; host-approved cgroup `memory.current`, `memory.events`, `cpu.stat`, `io.stat` where permitted, and TGserver correlation. Record tool `walkFiles` counts, scanned/read bytes, search coverage, hash/copy count, JSON serialized bytes, GC/retention outcomes and lifecycle stages. Respect Node 24 deployed APIs, minimal sampling overhead, redaction and no secret-bearing heap dumps. Missing/unsuitable counters are `UNKNOWN`. RSS is not automatically explained by V8 heap; avoid false memory-leak attribution.

**Prioritize measured high-cost candidates, not code-wide rewrites**:
1. For `read-only-tool-runtime-base.js`: bounded repository walks currently include synchronous I/O; design option is snapshot-aware (Source SHA) reuse and incremental coverage receipts or async/worker separation when profiling confirms Node event-loop blocking. Preserve Unicode exactness, symlink/path/security, Git dirty state and "zero hits in bounded scope ≠ repo absence"; never trust an incomplete index as exhaustive.
2. For `repository-snapshot.js` and `sandbox-runtime.js`: examine repeated directory copy/hash/buffered reads across the same immutable, approved Snapshot. Candidate is copy-on-write/content-addressed **within existing Sandbox storage** with verified source/candidate manifest, independent copies for mutations, original bytes and rollback. Avoid unsafe hardlink writes/shared mutable inodes and sweeping cache deletion. Preserve 8k/10k file and 256MiB guard boundaries until actual data warrants change. Monitor disk and memory tradeoffs; caching can increase RSS and must demonstrate net value.
3. For `runtime-evidence.js` / durable progress: reuse one authenticated immutable record, project small views and bounded streaming or indexed readback where appropriate; never delete required Evidence/Effect Ledger/active checkpoints. Different declared target policies (e.g. design 12h/32MiB operational cache vs source 24h/256MiB default) require archive acceptance and Host effective-config reconciliation before retention changes, not automatic "compression".
4. For `sandbox-verification.js`: presently executes configured checks in a per-candidate sequence. Build a **verification dependency graph**: cheap safe syntax/preflight before expensive tests, but independent mandatory checks remain required for final status. Skip only a check proven irrelevant by source/stack contract (not by model assertion); guard Oracle/Test deletion or assertion weakening. Multi-Run CPU-heavy job submission may be bounded in the current Sandbox lane when measured contention occurs, preserving Source/Candidate identity and recovery. `worker_threads` is a comparison option only for isolated CPU-heavy JavaScript, not a blanket I/O optimization. Do not add a second Sidecar/worker service without demonstrated need.
5. For Node long-lived Maps, JSON bodies and evidence projection: measure process heap growth by run and terminal cleanup; bounded transient caches may be evicted after evidence persisted and rebound, never while a live Run or redo safety depends on them. Never use "force GC" or reduced durability as a presumed RAM improvement.

### 27.6 Consumer-side AI Core integration, without duplicating the Core

Implement later, not in this design PR: thin Model→Gate URL/expected Model ID/credential/policy binding, endpoint preflight, request/Run route generation pinning, safe cancel/timeout error classification, output/Thinking actual contract and trace correlation. Stage A preserves legacy 18080 route until an authenticated read-only 4 Gate identity check and exclusive traffic ownership are proven; Stage B model-specific Gate activation requires Host contract qualification and safe rollback. Gate obtains/releases its own Core Lease for inference. DebugAI owns task order and role Evidence, not physical model Lease, per-model Docker, global fairness, KV memory or model reload. No route fallback directly to an unleased backend. Any product-handoff integration uses an existing AI Core Handoff ticket only when required by its published contract; no DebugAI-specific lifecycle server.

### 27.7 Resource-policy decision matrix and risk controls

| Candidate | Expected efficiency mechanism | Capability risk / negative test | Adoption condition |
| --- | --- | --- | --- |
| Stable prompt prefix + evidence view | fewer repeat tokens / possible prefix reuse | dropped counterexample, insufficient Evidence, increased `evidence.read` rounds | source-bound required items unchanged, fewer measured prefill tokens or full-run CPU-seconds and no quality regression |
| Role/Search Gate shadow evaluation | fewer unnecessary external calls | false skip; missing official source; false cause certainty | zero observed false-skip on required holdout cases and independent evidence criteria |
| Snapshot-aware reuse | fewer read/hash/copy operations | stale source, symlink escape, changed-dirty file, corrupt cache | identity/TTL/integrity negative tests; fewer bytes/CPU with correct baseline/candidate |
| Bounded Sandbox admission | reduced CPU/IO contention with model prefill | starvation, delayed required tests, accidental early COMPLETE | measured host contention relief and no increased full-run failures/p95 |
| Different-model Scout parallelism | eliminate avoidable queue wall time | RAM/CPU contention, cold churn, model-ID mismatch, stale response | same-host A/B improves qualified full-run metrics, both models maintain semantic quality, Core caps never bypassed |
| Early structural / deterministic preflight | reject invalid candidate before expensive checks | false rejection of valid code or weakening of full regression | all successful paths still execute mandatory actual Test/Reviewer gates |
| Model count 4→3 experiment | reduce model memory footprint | collapse role specialization, lost Thinking/reviewer independence | PR #108 paired independent role/full-task holdout and real resource proof, never plan-only promotion |

**Do not adopt:** lowering max_tokens because historical timeouts occurred; cutting hypothesis alternatives, counter-evidence, Tool admission, required real tests, Review, approval or durable retention; silently changing sampled model/Thinking; cross-product KV/session sharing; unrestricted workers; forced memory GC; introducing a second repository state engine or ad-hoc Host execution path.

### 27.8 Measurement/evaluation contract — quality first, resource second

Before changing behavior, capture an **exact current baseline**, with Source SHA and deployed SHA separated. Use three independently scored strata: (1) existing 50 investigation role cases and 60 code-candidate cases preserving their actual historical denominators; (2) unseen holdouts incl. Python bool/int, Unicode, hashing/equality, boundary, test-manipulation, contradictory Evidence, prompt injection, large repository/incomplete search; (3) at least one real native full workflow (investigation → patch candidate → approval-controlled apply → deterministic verification → fresh Local Reviewer → external final if required → Strict Completion) with explicit UNKNOWN if never reached.

Observe across the **same** GGUF hashes, llama.cpp build, CPU/RAM/cgroup conditions, `n_ctx`, `-np`, cache, Thinking/sampling, task/source SHA and external competition, otherwise mark comparisons *NONCOMPARABLE*. Pair Baseline A and one changed-axis Candidate B. Record:
- Role/phase semantic PASS/PARTIAL/FAIL/UNKNOWN with independently bound Evidence, actual tool calls, source inspection coverage, completeness and false-positive rate;
- verified full-run complete fraction, p50/p95 total wall time and time-to-first-qualified-evidence, useful work tokens and repeated-call count;
- Host Core vs Node/Sidecar/Sandbox CPU-seconds, throttling, event loop delay, peak RSS/cgroup memory and I/O bytes, model ready/cold/load, actual prefill/decode/cache hit, queue and retry wall time;
- whether a candidate merely moves work from model CPU to Node/sandbox or rehydration and thus changes net work cost;
- interruption, restart, unknown outcome, cross-project contention (when relevant and observable), pressure/429/503/timeout/late/Abort cases with exactly one valid terminal receipt.

**Non-regression gate:** keep mandatory test inventory and production role permission/output shapes, independent evidence requirements, exact versioned checkpoints and current model-capability ceilings. Any new false PASS, false skip, missing required Evidence, duplicate applied effect, reduced diagnosed-cause correctness, invalid/unreviewed patch or broken restart is an automatic REJECT even if average latency/RSS improves. For finite sample proportions report numerator/denominator and uncertainty; zero observed regressions is not a formal statistical guarantee. Adopt only improvements with reproducible resource/runtime gains and no observed capability regressions; if inconclusive retain current behavior and gather more independent cases. Do not invent speedup%, RAM savings or a new token target.

### 27.9 Bounded design-to-implementation sequence (not permission to implement now)

1. Lock latest owning PR #107 Source and design + Current, compare PR #109 exact deltas and its known failures. Map mandatory 6 Role/Tool/Authority/Evidence/Reviewer/Completion contract tests. Correct regressions without switching to outdated PR109 budgets. Baseline `DESIGN_VERIFIED` applies to the original product architecture, **this §27 remains PROPOSED_PR**.
2. Add **measurement only** to existing RuntimeEvidence/App/Sandbox owner (if a later implementation CU adopts this design), prove fidelity and overhead via isolated mocks and Host read-only resource tracing; keep source/live data distinction.
3. Extend existing prompt working view, duplicate-work resolution, Scope/Evidence/Tool contract; test impossible-to-skip and required reread before any new dynamic dispatch.
4. Optimize measured Node/Sidecar/snapshot hotspots one at a time; prefer small changes within existing modules, track actual memory and CPU before claiming savings.
5. Integrate optional model-aware workload policy and consumer Adapter/4-Gate route only with matching AI Core Stage A/B availability, safe rollback and shared-resource non-monopolization checks proportional to the change. Keep legacy serial baseline until qualified.
6. Qualify semantic quality and full real E2E after each meaningful behavior change; then select Pareto-improving candidates, update canonical adopted design in owning review, merge/Host reflect only through existing Work Routine and source/Host evidence.

Design alignment: `README.md`, `docs/CURRENT_STATE.md`, `docs/DURABLE-CONTINUATION-DESIGN.md` §§1–5, 8–12, 15, 19, 24, 26, Issue #41 Current and Notion DebugAI minutes. This proposal must NOT displace active PR #107 product-owner work or turn a drafted idea into deployed authority. **Documentation only** in this design PR.

### 27.10 Multi-project capacity and non-monopolization (Master scope correction 2026-10-14)

**Actual Master requirement:** At least three development-AI projects exist, so DebugAI **must not monopolize the shared CPU, memory, model residency or execution capacity**. The requirement is about leaving the common AI Core usable by other projects, **not** about dividing resources into three quotas, keeping three projects simultaneously active, imposing new three-way load tests as a universal acceptance gate, or proving each other product's full quality metrics as a prerequisite for ordinary DebugAI improvements. Do not invent a third product identity or make `N=3` a fixed capacity limit.

**One resource owner:** AI Core keeps its existing single common model Lease/Admission, CPU/RAM budget, fairness/backpressure and resident/eviction policy for all consumers. DebugAI must respect the published capacity/429/503/cancellation and release behavior and avoid unbounded queued requests, retries, overlong work or heavy Sandbox jobs that needlessly crowd out others. DebugAI does not create a second global scheduler, physical resource ledger, permanent reservation, fixed per-project split or direct model start/stop control. All six DebugAI roles, required evidence, tests and reviews remain intact.

**Minimum consumer-side design:** Limit the number and duration of **DebugAI's own** outstanding operations only when supported by measured contention and current business deadlines. Reduce redundant inputs, optional searches, Tool repeats and avoidable CPU/IO work first. Let AI Core admit and arbitrate shared inference; maintain the existing safe serial path until any parallelism is demonstrated not to bypass Core policy or starve other work. Do not treat currently unoccupied shared resources as DebugAI-exclusive. Existing physical Core limits (MemoryHigh 34GiB, MemoryMax 36GiB, CPU 6 cores) are a global configured ceiling, **not** guaranteed DebugAI allotments.

**Right-sized verification:** Confirm that DebugAI respects Core Admission/Lease, aborts/releases work correctly, avoids unbounded resource accumulation and leaves capacity available to other consumers. Use already available resource/queue telemetry and bounded contention/competing-request negative cases when changing scheduling or resource behavior. Where representative other project workloads already exist, compare interference; where they do not, a controlled two-consumer test or simulation can establish the relevant non-monopolization contract, with missing live evidence marked UNKNOWN. **A mandatory three-product simultaneous E2E or universal three-way fairness benchmark is not part of this requirement.** Additional real multi-project qualification is required only when the scope of a proposed change actually affects shared Core resource arbitration; AI Core owns the generic cross-product fairness policy.

**Design/authority:** This correction narrows an over-expanded interpretation of the Master's intent. It changes only this draft design document; no runtime config, Host capacity, project registration, API, code, CI gate or other project is changed.

### 27.11 Focused audit acceptance and first implementation slice (2026-10-14)

**Technical design audit: ACCEPT for a bounded, measurement-only first CU; broader §27 optimizations remain unqualified candidates.** Rechecked the owning Work Routine §6, actual current PR #107 SHA `302e4cae37c8d97d1decae6864d0f01565026f6c`, PR #109 regression/CI history, product purpose §§1–5/8–12/15/24/26, existing AI Core Adapter and Role Tool Loop telemetry, and recent real-run failures. No need for another resource manager, queue, persistence system or new Host transport. The design preserves current required roles, behavior, permissions, Evidence, output ceiling and Strict Completion. New experiments are gated behind observed quality/CPU/RAM results. §27.10 corrects the previously overbroad three-simultaneous-project gate; simply avoid DebugAI monopolizing the common resources.

**First selected implementation: non-authoritative Node-process resource observations at the existing adapter invocation boundary.** This is a source-compatible implementation addition, not a new core Scheduler or stateful resource manager. When the caller already requests progress events, add a **terminal-only** resource observation to the existing success/failure progress record. Capture the **Node process** user/system CPU time and RSS/heap/external/buffer snapshots at invocation start and terminal; include measured event-loop utilization delta when reliable. Attribute metrics to `SHARED_NODE_PROCESS`, not exclusively to a single role/model: concurrent requests or background jobs contribute to the same process values. These are **endpoint samples, not peak RSS, cgroup memory, GPU/model RAM, or standalone per-role CPU cost**. Never add them into AI Core backend compute totals or equate them with process-exclusive causation. Missing counters must remain null/UNKNOWN. Do not attach secrets, prompt text, model hidden reasoning, raw environment or unrelated process identities.

**Minimum safety/contract requirements**: preserve existing terminal `SUCCEEDED`/`FAILED` event order, `schema=debugai.ai-invocation/v1`, all former fields, timeout/retry/queue/deadline semantics, transport payload and call count; new counters are additive under `node_process_resources`. Sample without modifying callback/await/task ordering, swallow instrumentation measurement failures, and preserve fail-closed behavior of the actual model/contract. Test success and failure paths with fake network responses, no extra model requests, reasonable nonnegative counters, terminal UNKNOWN if unavailable and non-exclusive labeling. Never claim an observed performance improvement simply because measurement is installed. If running on Node app, this is application-process telemetry only, not Sidecar/Sandbox; those are separate later owners. Prefer existing RuntimeEvidence/TGserver event persistence: no second logger or storage layer.

**Review boundary:** The Master's instruction permits proceeding from audited design to implementation, but this `PROPOSED_PR` remains a design-only Draft until standard source/CI/readback and owning review. Approving this first telemetry-only CU does NOT automatically authorize §27 scheduling changes, model replacement, cache/retention changes, runtime memory enforcement, multi-model parallelism, or an unverified production cutover. Keep source implementation in a distinct branch/PR based on the reviewed design SHA; do not write into the concurrent Codex-owned PR #107 tree directly. Document actual SHA/CI/Host qualification separately and re-audit the implementation diff against §27.11 before merge.

### 27.12 Purpose correction: two-model dynamic residency is the migration goal (Master correction 2026-10-14)

**Primary development purpose, not merely an efficiency work item:** Convert DebugAI's existing full six-role debugging workflow so that its four selectable model identities can execute end-to-end on AI Core's **shared dynamic-residency platform: normally at most two model processes resident, the actual model identities changing on demand; an exceptional, bounded three-resident handoff window only if authorized by AI Core; return to ≤2 afterward**. This is to replace the old four-permanently-resident assumption without changing DebugAI's required role abilities, Tool/Evidence/approval/test/review behavior or model specialty. The available models remain Coder/Qwen3/Granite/Ministral for the current migration; six Roles do not mean six resident models. The present 34GiB MemoryHigh / 36GiB Max / CPU6 parent is **the shared AI Core budget**, not DebugAI-exclusive. Do not monopolize it; other AI projects must be able to use the shared Core.

**Reason for the correction:** §27.11's telemetry-only first CU is useful implementation infrastructure, but presenting it as the product development purpose was incorrect. CPU/RAM, Context and redundant-work optimization are *supporting means* necessary to make 2-resident switching useful on the actual server. A telemetry success, optimized prompt, lower RSS or module split alone is not completion.

**Responsibility split** (consistent with AI Core main `docs/DYNAMIC_RESIDENCY_HANDOFF_DESIGN.md` §§1, 3–5):
- **AI Core owner:** single common Model Registry/4 API compatibility, shared Admission and Lease, STOPPED/STARTING/READY/ACTIVE/IDLE/STOPPING lifecycle, cold launch/retire, bounded queue, normal 0–2 residents, temporary ≤3 on qualified handoff, model status/physical cgroup/CPU/RAM, fairness to other products and failure recovery. DebugAI must not duplicate those controls or directly launch/terminate models.
- **DebugAI owner:** role→backend model identity, six-role DAG and Thinking, actual model/role selection per stage, necessary cross-role *semantic* handoff, source/evidence and hypotheses, task deadlines, prompt/Tool and work result, full safeguarded verification/Review and Strict Completion. Consumer must send requests to AI Core's authorized API and handle ready/cold/retryable admission/failure/cancellation signals correctly, including completion and rollback of a handoff when such a contract is required. No second resident/Lease manager.
- **Cross-boundary:** the former single legacy 18080 Router remains a traffic compatibility mode until shared AI Core demonstrates every inference path uses the single Lease owner and dynamic residency in Host. User-facing DebugAI must not bypass the shared Core by reaching raw per-model ports or hardcode two particular model names. Project isolation/other consumers protected by the Core.

**Minimum product work and implementation order** (do not wait for unrelated optimization candidates):
1. Verify current PR #107 exact DebugAI Source/Design, 6 Roles→4 model aliases, versioned Adapter and AI Core Stage A/B accepted API contract, including current Host/Source separately. Retain all PR107 recent Model Profiles, Thinking, output/context budgets, Evidence/Tool/Resume and not PR109's stale branch overrides.
2. Complete the already-started **measurement-only** PR #111 while preserving existing source contracts; immediately after that, add a bounded fail-closed **consumer compatibility preflight** in the existing Adapter: select/verify a role's expected model identity and approved Core endpoint, API response schema and available/queued/error outcomes, without any direct model lifecycle manipulation. Default remains existing safe legacy path until actual Stage B is qualified. Do not force per-model routing solely because the four URLs exist.
3. Build a **six-role switching work-sequence qualification** through existing Workflow/RunAuthority (not a duplicate orchestrator): `Code Scout(Coder) → Causal Scout(Qwen3) → Researcher(Granite) → Diagnoser(Qwen3) → Patch Engineer(Coder) → Local Reviewer(Ministral)` is a switch-heavy contract scenario; the actual DAG may run permitted independent scouts in a different order, preserve evidence and optional source retrieval. Verify requests for stopped models do not hang permanently, blocked/queued requests have deadlines and resumable Work Item identity; no role is silently replaced because its model is cold.
4. Where AI Core's established Handoff API formally requires a client acknowledgement for a semantic-stage transfer, attach its `begin/complete/abort` ticket to the existing Work Unit and confirm previous/current model evidence remains accessible. Not every model call requires a bespoke handoff; do not fabricate lifecycle requests. Failures or cancellation must not leave a perpetual third resident slot or mark a stage COMPLETE without a result.
5. In Stage A use read-only Host/Core status plus mocks to prove model ID, shared Lease/Admission and legacy compatibility. In Stage B, when Core API/Host is ready, run a **real native debugging workflow** that traverses the four models and the six roles with normal ≤2 residents, bounded transient ≤3 only if needed, eventual ≤2, simultaneous other-product protection, acceptable CPU/RAM pressure and no stale evidence/replay. Record both real model switches and independently evaluated diagnosis/patch/test/review/Strict Completion. A Source CI pass or model-up HTTP200 is not this test.
6. Optimize actual measured context prefill, queues, Node/Sandbox CPU/RAM and repeated work *to enable those switches and protect capability*; retain improvements only when full end-to-end quality and throughput remain non-inferior. A proposed 3-model ROLE REMAP is a different experiment, not the physical 2-resident policy.

**Acceptance criterion of this development work:** six intact Roles using their four authorized models on AI Core shared dynamic residency, normal resident count ≤2, temporary handoff count ≤3 only per contract, actual required model transitions/ready/lease/deadline/recovery, all real debugging authority gates respected, verified end-to-end quality and recoverable failures, without exhausting shared capacity or falsely claiming completion. The number of simultaneous **resident model processes** and the number of **available model choices** must never be conflated. Any prerequisite missing from current AI Core must be reported as `AI_CORE_DEPENDENCY_BLOCKED` but DebugAI Source/Mock product work should continue.

**Status:** This §27.12 is an explicit correction of objective and implementation precedence, recorded in a design-only PR; it does not assert Stage B Host ready, 2-resident live migration, or any model switching E2E completed.


### 27.13 Module-first integration and runtime efficiency of six roles (Master sequence restored 2026-10-14)

**Master instruction reconciled and adopted as work sequence, not as new product scope.** The user's **first requested change** was genuine modularization of the six existing DebugAI roles; **second**, independently optimize the DebugAI-owned CPU, memory, Context, Tool, Sandbox and work-scheduling costs **after that modular boundary exists**; **third**, integrate those six reusable role modules with the shared AI Core's four available per-model APIs and normal ≤2 dynamically resident model processes, with temporary ≤3 only during an approved handoff. This is **one connected development program**; PR #109 is not an unwanted competing feature. PRs #110–#112 are supporting design and migration parts of that program; their existence does not establish that six-role modularization has been integrated.

**Preserve the real DebugAI product:** Six specialized agents remain Code Scout (Coder), Causal Scout (Qwen3 non-thinking), Researcher (Granite), Diagnoser (Qwen3 thinking), Patch Engineer (Coder), Local Reviewer (Ministral); 6 role identities / 4 selectable model artifacts / normally max 2 physically resident models are THREE DIFFERENT COUNTS. Keep all prior Role prompts, Skill selection, semantic success obligations, Code/Evidence references, security/Tool admission, bounded Work Unit, isolated tests, candidate-only patching, explicit approval, two allowed external review points, strict final verifier and failure recovery. Do not turn six modules into six separately resident inference servers, processes, heavyweight workers, per-role KV sessions or duplicate stores. "Separate modules" means replaceable, testable **logical role behavior** rather than new physical model ownership.

**What PR #109 actually delivered as of HEAD 5f56b0233779:** the six profile, contract, semantic and static budget fragments, a role-module index, a shared read-only Tool Loop/direct-call execution wrapper and a modified workflow dispatch. It is **meaningful source extraction** but does not by itself prove full independent stage handling, prompt/handoff/evidence runtime compatibility, efficiency savings, or correct integration with PR #107 and #112. Its base is old `main`, while PR #107 has changed Model Profile ceilings, Role/Tool/Evidence semantics and continuation. PR #109's latest exact-head Verify/Core/Public failures include a missing existing `run-observation-provider.js`, incompatible direct module test surface `createEvidenceContext`, and historical hard-coded token caps 600/800/2048/1024 where current PR #107 uses model-profile/v4 qualified generation ceilings (e.g. 8192 for Coder) and runtime-n_ctx clamping. These are concrete **capability/integration regressions**, not grounds to abandon the Master-ordered modularization. CodeQL PASS does not override them. NEVER merge PR #109 as-is, never fix CI by lowering current ceilings, suppressing tests, discarding evidence, or reverting newer features.

**Reconciliation and implementation order (Reuse First, current owners only):**
1. Treat PR #107's latest six-role behavior and current Core Work Unit/Tool/Evidence/Model Profile as the functional baseline; use PR #109's **role-specific module definitions as the intended modularization work product**, not as an old whole-tree replacement. Port/refit its smallest explicit module-owned slices onto the compatible PR #112 product branch only after auditing actual Source and existing tests; avoid reimplementing shared RunAuthority, Sandbox, Tool Loop, Reviewer and AI Core transport. Keep existing 6 roles→4 models mapping unchanged. Preserve latest `getModelOutputHardCeilingForRole`, role-specific Thinking and effective n_ctx clamping, no lower hard-coded historic budgets.
2. Make each role module's public contract cover stable identity, profile/Thinking, actual evidence/semantic criteria, capability output policy, optional role-specific prompt/workset construction and a narrow execution/handoff interface. Leave durable state, verified Effect Ledger, original Evidence storage, orchestration and Tool admission in existing shared owners; assert module contracts before dynamic role dispatch. No new AI manager or duplicate per-role queue.
3. **Optimize DebugAI-owned resources inside module boundaries** using actual per-run observations: construct only required role Context, carry small authenticated Evidence references instead of repeated full transcripts (with on-demand admitted `evidence.read`), do not repeat verified Tool/Source/Snapshot work, release per-role ephemeral buffers/outputs when the existing durable checkpoint is complete. Honor active runs and original evidence retention; never delete model reasoning requirements, disconfirming evidence or tests to save RAM. Measure Node/sidecar CPU seconds/RSS/heap/external, context tokens/cache hit/prefill, tool I/O and complete task quality, not just module sizes.
4. **Integrate module execution with 2-resident AI Core** through the same existing adapter/Gate contract: each module declares which of the four model identities it requires; runtime assembles an evidence-bound unit for that role, asks AI Core for inference, and accepts Core's global Lease/admission, cold-ready, deadlines and release. AI Core exclusively chooses which <=2 processes remain resident or evicts/starts the needed third/fourth selectable model; DebugAI never pins two slots, never owns model swaps, and must not consume all shared CPU/RAM. Allow reuse of Coder between Code Scout and Patch Engineer and of Qwen3 between Causal Scout and Diagnoser **only when DAG/evidence gates permit**—not by moving dependent stages ahead of verification or by denying other projects fair access. Temporary <=3 remains AI Core's bounded Handoff policy.
5. Design benchmark A = existing current 6 Role workflow and single adapter; B = compatible six-role modules with identical Role/Evidence/Authority behavior; C = same modules using the qualified Core normal ≤2 residency and versioned Gate routing. Compare individual role semantic outcomes, full real debug repair completion, source SHA/replay/rollback and CPU/RAM/queued/prefill/per-model switch wall time. Moduleization acceptance requires **functional parity first** (including old PR #107 holdout tests). Adoption of CPU/RAM optimization additionally requires measured net resource gain and no new false PASS, incomplete result, stale evidence or other product starvation. Neither structural CI PASS nor GET /v1/models identity alone proves runtime switching or completed debugging.
6. Record a single live integration owner and exact SHA/CI/Host evidence per CU, update existing Notion and GitHub Current; preserve PR #109 as historical, Master-requested feature branch until its useful modules have been brought forward and all failing regressions resolved. Existing Draft design PR #110, instrumentation PR #111, and route integration PR #112 remain traceable; do not silently fold conflicting whole branches together.

**Status at time of restoration:** Role modularization = SOURCE_PARTIAL / INTEGRATION_FAIL; 2-resident route consumer = SOURCE_CI_PASS (PR #112 HEAD 02b02dead854...), physical model switching / final six-role product E2E = NOT_VERIFIED; DebugAI CPU/RAM end-to-end saving = NOT_MEASURED. A measured rollback-safe unified implementation is still to be completed. The accurate development objective and order must not be replaced by a summary that describes CPU/RAM tuning alone.
