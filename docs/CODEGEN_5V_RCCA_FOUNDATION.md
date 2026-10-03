# DebugAI Future Code Generation — 5V-RCCA Foundation

Status: DESIGN AUTHORITY / NO RUNTIME IMPLEMENTATION AUTHORIZED
Target project: debugAI
Preserves: `docs/DURABLE-CONTINUATION-DESIGN.md`, `docs/CODEGEN_RELIABILITY_DESIGN_DELTA.md`, existing approval/evidence/reviewer/Strict Completion boundaries

## 1. Decision

Future DebugAI code generation and code repair SHALL use 5V-RCCA as the composition foundation rather than treating reusable code as unstructured snippets.

5V-RCCA remains an external architecture definition. DebugAI owns retrieval use, target adaptation, sandbox composition, target verification, repair, review, and completion decisions; ModuleCatalog owns reusable assets; G-ACE KB owns searchable retrieval data.

Core invariant:

```text
Verified(A) + Verified(B) != Verified(A+B)
```

Every composed unit must be verified against the responsibility of the newly composed unit before promotion.

## 2. Five levels used by code generation

```text
L1 Part               = one complete reusable responsibility
L2 Feature            = user-visible or behavior-complete function built from lower verified units
L3 Component          = broader responsibility containing multiple verified functions
L4 System             = independent system responsibility
L5 Application System = complete application responsibility
```

Levels are responsibility scopes, not directory/package/runtime-loader hierarchies.

## 3. Code generation control flow

```text
Master requirement
-> RequirementEnvelope / acceptance boundary
-> BASELINE RepositorySnapshot
-> repository localization + dependency/contract graph
-> Catalog / KB search for verified reusable units
-> choose highest applicable 5V level without forcing over-large reuse
-> verify provenance / verification boundary / compatibility
-> Sandbox composition workspace
-> compose/adapt code into target source shape
-> required-edit closure + semantic diff
-> compile/type/lint
-> targeted + adjacent/relevant regression
-> false-pass/test-strength checks
-> CANDIDATE RepositorySnapshot
-> Parent Responsibility Verification
-> fresh-context Local Reviewer
-> External Final Review when required
-> existing Strict Completion
-> approval boundary
-> target apply
-> target/runtime re-verification
-> eligible new Verified Asset candidate
```

No retrieved asset bypasses target-specific verification.

## 4. 5V Generation Contract

Every generated/composed candidate must carry at least:

- target 5V level;
- target responsibility;
- requirement/acceptance identifiers;
- baseline repository revision/snapshot identity;
- source asset identities and their 5V levels;
- source asset verification boundaries;
- composition lineage;
- adaptation/change plan;
- dependency/contract closure;
- target verification plan;
- target verification evidence;
- candidate snapshot identity;
- unresolved evidence gaps;
- promotion state: `CANDIDATE | VERIFIED | BLOCKED | REJECTED`.

Model confidence is not a verification field.

## 5. Selection and reuse rule

Search should prefer reuse at the highest responsibility level that actually fits the target contract. If an L4/L3 unit is too broad or incompatible, descend to L2/L1 and recombine instead of forcing the larger asset.

Reuse selection must consider:

- responsibility match;
- contract/API compatibility;
- target language/runtime/toolchain;
- dependency availability;
- repository conventions;
- security constraints;
- verification freshness/provenance;
- adaptation cost;
- target-specific re-verification cost.

A search hit is not an adoption decision.

## 6. Parent Own Verification

Lower verified units are evidence inputs, not proof of the parent.

For any newly composed unit U:

```text
inputs = verified lower-level units + target-specific new/modified code
U = Compose(inputs)
Responsibility(U) = explicit target responsibility
Verify(U, Responsibility(U), target repository context) = PASS
```

Only then may U be called Verified at its own level.

Examples:

- two verified Parts do not make a verified Feature;
- a verified Feature adapted to another repository is not automatically verified there;
- a verified Component modified by generated glue/config is a new candidate Component;
- a verified System used inside a new Application does not verify the Application.

## 7. Research-derived design requirements

Repository-level generation research supports the following design choices:

1. Relevant repository context must be retrieved iteratively rather than assuming a local file is sufficient.
2. Dependency-aware planning is required for repository-wide edits and cross-file closure.
3. Graph/symbol-aware localization should reduce wrong-file and missing-companion-edit errors.
4. Dependency utilization must be measured because generated code can pass tests while reimplementing or misusing repository dependencies.
5. Specification/intent inference plus independent review is useful before accepting generated repair candidates.
6. Generated tests need build/reliability/coverage or equivalent strength filters; generated-test existence is not proof.
7. Passing the current test suite alone cannot establish semantic correctness because weak/buggy tests can accept overfitting patches.

These papers are design evidence only. They do not prove this DebugAI implementation until measured on DebugAI itself.

## 8. Sandbox + Snapshot relationship

5V-RCCA defines responsibility-level composition and re-verification. Sandbox/Snapshot are supporting DebugAI systems, not part of 5V-RCCA itself.

For future code generation:

```text
BASELINE Snapshot
-> materialized Sandbox workspace
-> retrieve 5V candidates
-> compose/adapt
-> verify parent responsibility
-> CANDIDATE Snapshot
```

Large repositories remain physically materialized in Sandbox while only task-relevant files/symbols are hydrated into active AI context.

Archive/ZIP import/export is transport. `RepositorySnapshot` and source-bound manifests remain the logical repository-state authority.

## 9. Failure routing

- wrong responsibility decomposition -> Requirement/5V level selection
- wrong reusable asset -> retrieval/compatibility selection
- missing dependency or companion edit -> localization/change plan
- composition conflict -> Sandbox composition
- compiler/type/lint failure -> compile-feedback repair
- regression failure -> diagnosis/repair
- weak generated test or false PASS -> test-strength gate
- parent verification insufficient -> evidence acquisition / BLOCKED
- stale baseline/current target mismatch -> reject apply and regenerate/rebase candidate from current baseline
- repeated same failure without new evidence -> NO_PROGRESS/BLOCKED

## 10. Asset promotion loop

The intended reuse loop is:

```text
ModuleCatalog
-> G-ACE KB
-> DebugAI retrieval
-> Sandbox composition/adaptation
-> Target verification
-> Verified candidate at explicit 5V level
-> promotion candidate
-> ModuleCatalog (separate owner/process)
```

DebugAI must not silently register/promote Catalog or KB records from this workflow.

## 11. Acceptance evidence for implementation

Runtime implementation is not complete until evidence covers at least:

- L1 Part reuse without unnecessary regeneration;
- L1 -> L2 composition with parent verification;
- L2/L1 -> L3 composition with cross-file dependencies;
- incompatible higher-level asset rejected and lower-level fallback selected;
- verified source asset adapted to a target and correctly forced through re-verification;
- dependency utilization / duplicate-reimplementation checks;
- weak-test/false-pass negative cases;
- stale Snapshot/revision rejection;
- large repository Sandbox E2E;
- archive -> Sandbox -> candidate -> archive round-trip where archive transport is used;
- same-model/same-tools comparison versus zero-from-scratch generation;
- net-benefit measurement including search/retrieval/adaptation/reverification cost.

L4 System and L5 Application System remain unproven until real target E2E evidence exists. Do not promote Paper 1 T1-T3 evidence into L4/L5 claims.

## 12. Metrics

Minimum comparison metrics:

- Time to Verified Completion;
- Novel Code Ratio;
- Repair Burden;
- Reuse Precision;
- False Pass Events;
- required-edit recall;
- dependency utilization / duplicate responsibility reimplementation;
- out-of-scope edit rate;
- re-verification cost;
- search/retrieval/adaptation cost;
- completion false-positive rate.

## 13. Current boundary

This document changes future design authority only.

Current state:

```text
5V_RCCA_CODEGEN_FOUNDATION=DESIGNED
5V_LEVEL_RUNTIME_ROUTING=NOT_IMPLEMENTED
PARENT_OWN_VERIFICATION_RUNTIME=NOT_IMPLEMENTED
CATALOG_KB_TO_DEBUGAI_5V_E2E=NOT_EXECUTED
L1_L3_NET_BENEFIT_ON_CURRENT_DEBUGAI=NOT_PROVEN
L4_L5_REAL_E2E=NOT_PROVEN
MERGE=NO
DEPLOY=NO
PRODUCTION_CHANGE=NONE
```
