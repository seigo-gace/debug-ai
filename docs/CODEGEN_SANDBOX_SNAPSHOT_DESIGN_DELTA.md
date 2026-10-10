# DebugAI Codegen Sandbox / Snapshot / Archive Design Delta

Status: DESIGN ONLY / NO RUNTIME IMPLEMENTATION AUTHORIZED
Target project: debugAI
Companion to: `docs/CODEGEN_RELIABILITY_DESIGN_DELTA.md`
Baseline preserved: `docs/DURABLE-CONTINUATION-DESIGN.md`

## 1. Purpose

Define the future code-generation workspace that can safely accept a repository tree or archive, preserve a large file set exactly, construct and repair code inside an isolated sandbox, create reproducible baseline/candidate snapshots, verify the result, and only then promote an approved candidate toward the real repository.

This design does not replace the existing DebugAI sandbox, durable state, `RunAuthority`, patch-candidate contract, approval boundary, or verification workflow. It closes a missing code-generation-specific design area around archive ingestion, exact repository materialization, large-tree integrity, snapshot identity, sandbox construction, candidate export, and round-trip verification.

## 2. Current boundary

Existing DebugAI already has a sandbox execution path and a running sandbox-runner. Existing sandbox security restrictions remain authoritative. Current evidence also shows that sandbox job snapshot copying excludes `build` and `node_modules`; this can make whole-repository self-verification incomplete when required native/dependency artifacts are not independently provisioned.

Historical/local handoff ZIP files are evidence of transport/packaging activity, not proof that current DebugAI owns a production-grade ZIP ingestion/export pipeline.

Therefore:

- existing sandbox execution = EXISTS;
- codegen Sandbox-First workspace = PARTIAL / NOT YET CONNECTED as a complete generation pipeline;
- baseline/candidate repository snapshot contract = DESIGN REQUIRED;
- large-file-count exact archive ingestion/export = NOT IMPLEMENTED as a verified DebugAI runtime capability;
- ZIP round-trip preservation = NOT VERIFIED;
- archive-to-sandbox-to-candidate E2E = NOT EXECUTED.

## 3. Authority split

`RepositorySnapshot` is the logical identity authority for a materialized repository state.

ZIP/TAR/etc. are transport containers only. Archive byte identity alone must not substitute for repository-content identity because compression method, timestamps, entry order, and metadata can change without changing repository content.

A snapshot identity should bind at least:

- source repository / task binding;
- source revision when available;
- normalized relative path;
- entry type: regular file / directory / symlink;
- file byte hash;
- executable bit / required mode metadata;
- symlink target without dereferencing outside the sandbox;
- selected repository contract/index digests;
- total entry count and total materialized bytes;
- snapshot schema/version;
- deterministic manifest digest.

Optional platform metadata may be retained when required, but unsupported metadata must be reported rather than silently invented.

## 4. Required flow

```text
Repository / uploaded archive / retrieved reusable bundle
  -> transport integrity check
  -> safe archive inventory without execution
  -> extraction-policy validation
  -> bounded streamed extraction into staging area
  -> path/type/size/count validation
  -> exact RepositorySnapshot BASELINE manifest
  -> full-tree integrity verification
  -> isolated Sandbox Workspace materialization
  -> repository index / symbol / dependency / test index
  -> candidate generation + multi-file construction
  -> compile / type / lint / targeted + relevant tests
  -> semantic diff / false-pass / evidence gates
  -> RepositorySnapshot CANDIDATE manifest
  -> BASELINE vs CANDIDATE exact diff
  -> independent review
  -> VERIFIED CANDIDATE
  -> optional deterministic export archive
  -> export re-read + manifest/hash round-trip verification
  -> existing approval boundary
  -> approved apply to real repository
  -> real repository/runtime verification
```

## 5. Large repository / many-file rule

A large repository must be physically preserved in the sandbox without requiring every file to be inserted into an LLM prompt.

Separate:

1. **Materialized tree** — complete allowed repository content needed for execution/build/test.
2. **Snapshot manifest** — exact paths/types/hashes/metadata and tree identity.
3. **Structural indexes** — file tree, symbols, references, dependency graph, test map.
4. **Active AI context** — only task-relevant files/symbols/evidence, rehydrated on demand.

Large file count is not permission to omit files silently. If policy excludes an entry, the exclusion must be explicit, deterministic, recorded in the snapshot contract, and proven not to invalidate the requested verification. Required files that cannot be materialized make the snapshot `INCOMPLETE/BLOCKED`, not PASS.

## 6. Archive ingestion safety

Archive handling must be fail-closed before extraction.

Required protections include:

- reject absolute paths;
- reject `..` traversal / Zip Slip;
- reject entries escaping the staging root through symlinks/hardlinks;
- reject device nodes, sockets, FIFOs, or unsupported special files unless a separately authorized contract exists;
- bound entry count, individual uncompressed size, total uncompressed size, nesting/decompression expansion, and extraction wall time;
- stream extraction rather than loading a whole large archive into memory;
- never execute archive content during inventory/extraction;
- preserve file bytes exactly;
- preserve executable-bit/symlink semantics required by the target repository;
- record unsupported metadata explicitly;
- detect duplicate/conflicting normalized paths;
- deterministic handling of case-collision hazards for cross-platform repositories;
- Secrets remain data and must not be copied into prompts/logs merely because they exist in the archive.

Limits must be configurable by verified policy and measured environment capacity. This design does not invent fixed production numbers before measurement.

## 7. Snapshot model

### BASELINE SNAPSHOT

Created after safe materialization and before candidate mutation. It freezes the exact working input.

### CANDIDATE SNAPSHOT

Created after candidate construction and verification. It binds the complete resulting tree and the evidence generated by verification.

### APPLY GATE

A candidate cannot be applied when:

- baseline source/revision no longer matches the intended target;
- required files disappeared without an approved deletion;
- snapshot manifest is incomplete;
- candidate contains out-of-scope entries;
- archive/export round-trip changes bytes or required metadata;
- verification evidence belongs to a different snapshot/revision.

A changed target requires rebase/reconstruction/reverification, not silent apply.

## 8. Sandbox construction rule

The sandbox is the construction area, not merely a test runner.

Future codegen work must be able to:

- materialize the complete allowed baseline tree;
- create/modify/delete multiple files as one candidate change unit;
- generate supporting files required by the requested implementation when in scope;
- run deterministic repository-native verification under the existing security boundary;
- compare multiple candidates without touching the real repository;
- discard failed candidates safely;
- retain evidence and candidate identity needed for review/resume;
- resume interrupted construction only when snapshot/source/tool identities still match.

No sandbox PASS is promoted directly to Production PASS. Environment-specific verification remains separate.

## 9. Dependency and generated-artifact policy

Do not blindly copy every cache/build artifact and do not blindly exclude them either.

Each class must have an explicit owner/policy:

- source and repository-owned fixtures/config/assets: normally snapshot material;
- lockfiles/manifests: snapshot material when repository-owned;
- dependencies (`node_modules`, virtualenv, vendor trees): reproduce from locked authority or include only when the target contract explicitly requires exact vendored bytes;
- native/build outputs: provision from exact source/toolchain identity when verification requires them; never use a mismatched binary fallback;
- caches/temp/logs: excluded unless they are the explicit task input;
- Secrets: never made model context merely to preserve a snapshot.

An excluded dependency/build tree must not cause a false whole-repository PASS. If required provisioning is unavailable, verification is BLOCKED.

## 10. Export / recompression contract

When the user or parent agent needs a ZIP/archive result, export is a packaging step after candidate verification.

Required export proof:

1. generate archive from CANDIDATE snapshot;
2. compute transport archive hash;
3. re-open the produced archive through the same safe inventory path;
4. extract to a fresh verification directory;
5. recompute the repository snapshot manifest;
6. require candidate manifest equivalence for all required entries/bytes/metadata;
7. only then mark `ARCHIVE_ROUNDTRIP=PASS`.

Compression ratio, archive entry order, or archive timestamps are not repository correctness evidence.

## 11. Scale / storage strategy

For large trees, avoid repeatedly copying every unchanged byte when a safe local mechanism can preserve identity. Implementation may use content-addressed blobs, copy-on-write/reflink, hardlink with mandatory copy-before-write protection, or other measured mechanisms, but the chosen mechanism must not allow candidate writes to mutate the baseline snapshot.

Optimization is subordinate to exactness. Snapshot identity must remain deterministic regardless of storage optimization.

## 12. Required tests before implementation can be called complete

At minimum:

- thousands/tens-of-thousands-file repository materialization test;
- mixed small/large file test;
- zero-byte files and empty directories where semantically relevant;
- executable file preservation;
- symlink preservation and escape rejection;
- duplicate/case-collision archive rejection;
- path traversal rejection;
- decompression-bomb/size/count-limit rejection;
- interruption during extraction with safe cleanup/resume behavior;
- baseline immutability while candidate changes many files;
- cross-file candidate generation and deletion/addition/rename cases;
- native/generated dependency provisioning with exact source binding;
- candidate snapshot exact diff;
- ZIP export/re-import round-trip equality;
- stale target revision rejection before apply;
- sandbox PASS followed by intentionally different runtime state to prove sandbox PASS does not overclaim Production PASS;
- real large-repository E2E with measured wall time/storage/memory overhead.

## 13. Integration with codegen reliability design

The codegen reliability flow is strengthened to:

```text
Requirement / Intent
  -> BASELINE RepositorySnapshot
  -> Sandbox Workspace
  -> context/reuse/change-plan gates
  -> Patch Engineer candidate construction
  -> compile/type/lint/tests/semantic-diff/false-pass
  -> CANDIDATE RepositorySnapshot
  -> independent review
  -> archive round-trip when an archive artifact is required
  -> approval
  -> real repository apply and verification
```

The sandbox/snapshot layer supplies exact repository identity and an isolated construction surface. It does not duplicate the existing six roles, `RunAuthority`, durable continuation, evidence registry, or Strict Completion.

## 14. Current status

This document is a formal design delta only.

`EXISTING_SANDBOX_EXECUTION=YES`
`CODEGEN_SANDBOX_CONSTRUCTION_PIPELINE=PARTIAL_NOT_CONNECTED`
`BASELINE_CANDIDATE_SNAPSHOT_CONTRACT=DESIGNED`
`LARGE_TREE_EXACT_PRESERVATION_RUNTIME=NOT_IMPLEMENTED`
`ZIP_SAFE_INGEST_RUNTIME=NOT_IMPLEMENTED`
`ZIP_EXPORT_ROUNDTRIP_RUNTIME=NOT_IMPLEMENTED`
`ARCHIVE_TO_SANDBOX_TO_CANDIDATE_E2E=NOT_EXECUTED`
`MAIN_MERGE=NO`
`DEPLOY=NO`
`PRODUCTION_CHANGE=NONE`

## 15. Candidate-aware preapproval verification — Codex CU, 2026-10-09

Purpose: close the actual Source gap where `collect(repo)` checked only BASELINE
and Workflow returned a generated candidate without executing its changed code.
The adopted Unified Plan §13.1(4), reliability delta §13 and Codex execution §5
remain the baseline: construct first, verify isolated modified code, bind evidence,
then retain explicit approval. PR63–65 already qualify bounded construction,
canonical PatchCandidate adaptation and identity; this CU extends those owners.

Chosen method: reuse `preparePatchCandidateSandboxJob` for every configured
lint/typecheck/test/build action in `collectCandidate`. Revalidate canonical hash
and current preconditions before execution and after each check; bind job/action,
BASELINE/CANDIDATE manifest/delta digests and canonical ID/hash on readback. All
checks must start from the same BASELINE and CANDIDATE digests. Reinventory the
owning source after each execution, rejecting unrelated-file drift as well as
selected-file drift. Each check gets a fresh isolated copy; build side effects do
not contaminate the next check. `FINAL_VALID` describes configured command outcomes
only; semantic correctness and whole-tree completeness stay UNKNOWN/NOT_VERIFIED.

Workflow owns invocation for initial Patch Engineer candidates and bounded re-fix
candidates before PATCH_READY/WAITING_APPROVAL. It registers deterministic check
Evidence, persists `candidate_verification` through existing RuntimeEvidence and
returns it with the candidate. A failed command yields FINAL_INVALID evidence;
a transport/integrity exception is persisted as failure and propagated. Existing
approval states remain candidate-only; neither FAIL nor PASS grants apply or
Strict Completion. Fresh failing-check-driven preapproval re-fix remains a next
CU; this change does not automatically consume new model calls or approve a fix.

### 2026-10-10 P1-C bounded preapproval refix wiring — current source delta

The preapproval regeneration path is additionally gated on the existing\nconfigured hypothesis reviewer; it invokes the same external FREE-bounded\nreview with existing Local Reviewer fallback and proceeds to Patch Engineer\nonly on a fresh PASS. No reviewer configured, FAIL, PENDING or INSUFFICIENT\nmeans no regenerated candidate; negative verdict is persisted and the run\nremains incomplete. Offline regression uses a stub reviewer with zero HTTP.\n\nAfter the original candidate is checked in the unchanged isolated Sandbox,
an actual FINAL_INVALID with at least one executed failing check may trigger
**one** local-model preapproval re-diagnosis and Patch Engineer candidate
regeneration, but only where existing persistent RuntimeEvidence read/write and
PatchService are available. Existing failed-check records become registered
Evidence and are supplied with the *same* immutable Patch Packet and source
precondition boundary. The fresh candidate must differ in canonical candidate
hash; a second isolated check is recorded and never fabricated as passing.
Each run persists a preapproval_refix_attempt record before local role calls
and at most one preapproval_refix_result. Subsequent entry to the same Run
cannot consume another preapproval attempt. Source/CI may qualify the contract
but are not proof of local inference success or true bug repair.

This preapproval retry never applies a candidate or changes approval authority.
A still-invalid second candidate remains explicitly FINAL_INVALID and must not
be mistaken for semantic completion. The existing WAITING_APPROVAL state
continues to mean candidate-only; it never means candidate verification passed.
The post-approval bounded refix path remains separate. No Scout, AI Core
transport, scheduler, provider quota, new model or parallel project is changed.


Dependency admission is deliberately explicit: declared dependencies/dev/optional/
peer dependencies return NOT_CONFIGURED / CANDIDATE_DEPENDENCIES_NOT_QUALIFIED.
Candidate jobs do not receive Sidecar-global node_modules or NODE_PATH. No npm
install, host cache/native artifact injection, network expansion, SIGKILL
supervisor or alternative execution path is introduced. This qualifies Node-based
JS scripts needing no package dependencies. TS compiler-backed candidate execution
requires future exact dependency admission; ordinary real TS7 regression is a
separate existing gate. Missing scripts/package remain NOT_CONFIGURED.

In this slice, candidate edits to conventional test/spec files/test directories or
package manifests/lockfiles return CANDIDATE_ORACLE_CHANGE_NOT_QUALIFIED. The
configuration-oracle follow-up also holds changes to tsconfig*.json, ESLint,
Jest and Vitest conventional configuration names (including nested paths). This is
an execution qualification restriction, not a rejection of the product's required
future test-generation/configuration capabilities. Baseline test oracle is preserved;
arbitrary test-strength/overmock/semantic-diff proof remains unqualified.

Configuration-oracle follow-up (2026-10-09): the first collector guarded tests and
package files but allowed edits to configuration that can weaken the same checks.
Before widening dependency execution, reuse the collector's existing pre-job
qualification predicate to hold these edits before creating a job. The fail-first
regression on PR69's prior head reached execution for tsconfig.json; the corrected
negative covers six conventional paths. An independent ordinary configuration.js
source-edit holdout beside an unchanged strict tsconfig remains executable.
Existing real Sidecar controls retain baseline PASS, wrong-code/syntax FAIL and
equivalent-code/boundary holdout PASS; an additional wrong-code plus weakened
configuration candidate stays NOT_CONFIGURED with zero checks and unchanged
owning source. These measurements qualify a bounded name-based guard, not ESLint
or TS compiler semantic execution for the new candidate.

Alternatives: expanding dependency admission first would widen an oracle gap;
interpreting changed configuration or trusting command PASS needs independent
test-strength evidence and is deferred. Rejecting all files containing "config"
would unnecessarily withhold ordinary product edits. Keep conventional names
only and preserve the same NOT_CONFIGURED reason and approval state. Config edits
are not forbidden product capabilities; execution qualification waits for their
test-strength gate. Custom configuration names, imported test helpers, alternate
lockfiles and arbitrary oracle-dependency closure remain unqualified; this predicate
is not exhaustive protection or evidence that unchanged tests are strong.
Rollback: revert this follow-up's predicate, tests and selftest changes; stored
candidate identity/state formats, dependency policy and Sandbox permissions do not
change. Source/CI final counts and exact readback are recorded on #41/#42.

Alternatives rejected: checking the untouched owning repo (cannot attest candidate);
new executor/optional model tool (duplicates existing ownership and lets checks be
skipped); borrowing global dependencies (unbound target artifacts); automatically
installing generated dependencies (unqualified execution/network); silently trusting
changed tests (false PASS). Existing isolated copies give direct provenance with
less implementation than a new workspace subsystem. No architecture replacement.

Verification: fail-first 3/3 new regressions failed on the handoff baseline because
collectCandidate was absent. Corrected focused regressions cover edited bytes,
runtime FAIL, tamper/stale rejection, unrelated result rejection, workflow invocation
and Evidence persistence, test-oracle weakening, unrelated source drift, global-dependency denial and inspect readback. Ordinary canonical verify:
571/571 PASS, zero failures/skips. Existing Core Verify queue gate additionally
runs actual Sidecar baseline + bad-runtime + bad-syntax + valid equivalent candidate,
including unchanged independent negative/zero holdouts; exact CI and local Sidecar
results are recorded on the owning PR and Issues #41/#42 after execution.

Safety/compatibility/rollback: no owning source mutation, candidate approval/apply,
merge/deploy, Role/model/provider/Secret/Host authority change. `collect(repo)`
retains its prior read-only contract. Legacy/unconfigured lane returns explicit
NOT_CONFIGURED, preserving older fixtures without inventing candidate success.
Rollback is a normal revert of this CU; no stored PatchCandidate hashes or approval
receipts are reinterpreted. Source/CI qualification does not qualify live Runtime,
50/60 semantic improvement, large trees, archive support or Strict Completion.

### 2026-10-09 GPT CHAT handoff — package-manager oracle admission

**Owner and scope**: Master reported Codex capacity exhausted and transferred this
one bounded product CU to GPT CHAT. Existing PR69 branch/worktree and other
projects are preserved; no new Branch, Server checkout, executor, or Sandbox
permission is required. Source finding (the basis of this follow-up):
`orchestrator/verify-core.js:packageManager()` selects pnpm/yarn/bun from their
lockfiles, yet preapproval `changesVerificationOracle()` previously only held
npm manifests, tests and selected compiler/test configurations. A candidate
can therefore edit dependency execution authority while keeping its
application implementation unchanged. This is a proven *code-path policy
gap*, not a claim of a real exploit or successful model repair.

**Adopted narrow guard**: Extend the existing pre-job deny predicate to
cover `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`/`bun.lockb`,
`.npmrc`, `.yarnrc`/`.yarnrc.yml`, `.pnp.*` runtime files,
`.pnpmfile.*`, `pnpm-workspace.yaml`, `bunfig.toml` and the
`.yarn/` package-manager plugin/release/cache tree, including nested
package paths. Unqualified candidate edits return
`NOT_CONFIGURED / CANDIDATE_ORACLE_CHANGE_NOT_QUALIFIED` before
job creation. Ordinary source files, including application configuration
not governing package/test execution, remain eligible under existing scope
rules; unedited package lock/config files may coexist with eligible changes.
Package dependencies are **still NOT_CONFIGURED** until a separate immutable
artifact provenance admission gate is independently verified.

**Why, and alternatives rejected**: Automatically executing with modified
lockfiles/manager config lets an unqualified candidate control verification
dependencies or weaken the oracle. Broadly banning every source filename
containing `config` would degrade valid application repairs. Introducing
another artifact provisioner, arbitrary package-manager install, network,
or global dependency mounts would bypass the existing Sidecar trust owner
and requires additional qualification. Thus only widen the existing
conventional-artifact hold now, while preserving the original design,
approval/apply policy and an evidence-based path to future valid
dependency updates.

**Acceptance and safety**: fail-first candidate modification negatives
must show unqualified artifact edits previously reached job dispatch.
After the fix, each lock/manager policy negative must return
`NOT_CONFIGURED` with zero Sidecar wait calls and zero job creation,
and original files unchanged. Independent holdout must allow a normal
source-only candidate beside unchanged package files. Preserve
preapproval-only verification, Sidecar+Landlock+seccomp boundaries,
strict result ID/hash binding, false-PASS rejection and no owning source
writes. Exact-head canonical and real Sidecar/CI qualification is
recorded separately in #41/#42 **only after actual execution**.

**Remaining limitations**: this bounded *name/path* admission is
deliberately not a full arbitrary code/helper/script provenance proof:
custom-named config imports, script-invoked alternate tools, yarn/PnP
resolver semantics, symlinked artifacts, and complete test strength remain
UNQUALIFIED. It does not provide real TS7 compiler execution for
third-party candidate projects, install dependencies, permit changing tests,
or establish live AI semantic success. Later immutable dependency artifact
admission must reuse trusted existing provenance owners with explicit
mismatch/unavailable negative tests. Rollback is a normal revert of this
single source predicate, two new regressions and this addition; no
stored candidate schema or runtime permission changes.
