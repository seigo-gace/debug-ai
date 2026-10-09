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

Dependency admission is deliberately explicit: declared dependencies/dev/optional/
peer dependencies return NOT_CONFIGURED / CANDIDATE_DEPENDENCIES_NOT_QUALIFIED.
Candidate jobs do not receive Sidecar-global node_modules or NODE_PATH. No npm
install, host cache/native artifact injection, network expansion, SIGKILL
supervisor or alternative execution path is introduced. This qualifies Node-based
JS scripts needing no package dependencies. TS compiler-backed candidate execution
requires future exact dependency admission; ordinary real TS7 regression is a
separate existing gate. Missing scripts/package remain NOT_CONFIGURED.

In this slice, candidate edits to conventional test/spec files/test directories or
package manifests/lockfiles return CANDIDATE_ORACLE_CHANGE_NOT_QUALIFIED. This is
an execution qualification restriction, not a rejection of the product's required
future test-generation/configuration capabilities. Baseline test oracle is preserved;
arbitrary test-strength/overmock/semantic-diff proof remains unqualified.

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
