# DebugAI Future Code Generation Reliability Design Delta

Status: DESIGN ONLY / NO RUNTIME IMPLEMENTATION AUTHORIZED
Target project: debugAI
Applies to: future code-generation and code-repair reliability work
Baseline preserved: `docs/DURABLE-CONTINUATION-DESIGN.md`
Current-state authority remains: `docs/CURRENT_STATE.md`

## 1. Purpose

Increase the reliability of generated or repaired code by reducing wrong implementation, incomplete cross-file changes, unsupported claims, false PASS, and premature completion decisions.

This delta does not replace the existing DebugAI architecture, six-role workflow, `RunAuthority`, evidence model, approval boundary, Local Reviewer, External Review, Strict Completion, durable continuation, or existing deterministic verification. It extends the current Patch Engineer / verification path with code-generation-specific planning and verification gates.

## 2. Responsibility boundary

DebugAI owns:
- selecting task-relevant repository context and verified reusable candidates;
- producing an evidence-bound change plan;
- generating candidate-only code changes;
- verifying candidate scope, compile/type/lint/test effects, semantic diff, regression strength, and evidence sufficiency;
- routing failed verification evidence back into bounded repair;
- refusing PASS/COMPLETE when evidence is insufficient or stale.

DebugAI does not own:
- creating or curating ModuleCatalog assets;
- registering or validating G-ACE KB corpus records;
- silently modifying Catalog / KB source;
- turning retrieved reusable code into trusted code without target-specific verification;
- bypassing Master approval for mutation;
- weakening existing tests, security controls, or Strict Completion to obtain PASS.

ModuleCatalog is a read-only reuse-candidate source for this design. G-ACE KB is a read-only search/retrieval source for this design.

## 3. Required processing flow

```text
Request / failure / target repository
  -> Requirement + intent extraction
  -> Repository scope / dependency / contract context selection
  -> Catalog / KB reusable candidate lookup when relevant
  -> Change-plan + required-edit closure
  -> Patch Engineer candidate generation
  -> Candidate structural / semantic diff gate
  -> Compile / type / lint feedback
  -> Targeted tests
  -> Adjacent / full-relevant regression expansion
  -> Test-strength / false-pass gate
  -> Evidence sufficiency + hypothesis falsification
  -> bounded repair with evidence delta only
  -> fresh-context Local Reviewer
  -> existing External Final Review when required
  -> existing Strict Completion Gate
```

No stage may treat generated code, a green command, or a reviewer opinion by itself as proof of completion.

## 4. Inputs

Required or conditionally required inputs:
- immutable Master request / accepted task contract;
- current repository revision and allowed scope;
- relevant repository rules and local/path-specific instructions;
- failure evidence when debugging;
- symbol/reference/dependency information;
- existing tests and verification commands;
- existing DebugAI evidence, invariant, history, runtime-trace, and source-verification surfaces;
- verified reusable candidate metadata from ModuleCatalog / G-ACE KB when available;
- current runtime/source identity when runtime behavior is part of the claim.

Missing required inputs remain explicit gaps. They are not reconstructed from model confidence.

## 5. Outputs

The future code-generation path should produce bounded, durable artifacts rather than free-form confidence:
- `RequirementEnvelope`: explicit requested behavior, preserved constraints, forbidden changes, acceptance conditions;
- `ContextEnvelope`: selected files/symbols/contracts/dependencies and why each is relevant;
- `ReuseCandidateSet`: retrieved candidate assets plus provenance, compatibility status, and rejection reason when not reused;
- `ChangePlan`: required edits, companion edits, dependency closure, verification impact;
- existing patch candidate contract;
- `VerificationEvidence`: compile/type/lint/test/runtime observations with exact source binding;
- `SemanticDiffAssessment`: requested change coverage, out-of-scope edits, contract removals/weakening;
- `RegressionAssessment`: selected regression targets, generated-test status, test-strength evidence;
- `EvidenceDelta`: what new evidence justifies another repair attempt;
- existing reviewer and Strict Completion outputs.

These artifacts may be implemented using existing packet/core providers rather than model-callable tools when that better preserves responsibility boundaries.

## 6. Existing-function classification

| Capability | Classification | Design decision |
| --- | --- | --- |
| Failure Scope Reduction | IMPROVE / INTEGRATE | Reuse Code Scout, targeted regression strategy, cross-file dependency trace, and current scope/revision gates. Do not create a second scope authority. |
| Source / Runtime Correlation | ALREADY EXISTS + IMPROVE | Current revision/runtime mismatch and source verification already fail closed. Extend codegen claims to require exact source/runtime binding only when runtime behavior is asserted. |
| Hypothesis Falsification | ALREADY EXISTS | Existing falsifiable hypothesis contract remains authoritative. Codegen repair uses it; no duplicate falsification engine. |
| Evidence Sufficiency Assessment | ALREADY EXISTS + IMPROVE | Existing Researcher/Diagnoser/evidence rules already preserve insufficiency. Add a codegen-specific gate before repair/review transitions. |
| Fresh-context Review | ALREADY EXISTS | Local Reviewer remains the fresh-context reviewer. Do not add another equivalent reviewer role. |
| Overclaim / False-completion Review | ALREADY EXISTS + IMPROVE | Existing External Final Review and Strict Completion remain final owners. Feed codegen-specific evidence and false-pass findings into them. |
| No-progress Evidence Delta Control | ALREADY EXISTS + IMPROVE | Reuse ProgressController/no-progress and durable state. A repair retry requires new evidence, changed hypothesis, changed candidate, or changed verification condition. |
| Context-aware Code Generation | NEW INTEGRATION REQUIRED | Reuse Catalog `contextAwareContractCodegen` and repository-map/symbol context. Connect it to Patch Engineer candidate generation; do not create a second code generator. |
| Compile-feedback Repair | NEW INTEGRATION REQUIRED | Reuse Catalog `compileFeedbackRepair`; feed deterministic compiler/type/lint failures back into bounded repair. |
| Semantic Diff Review | NEW INTEGRATION REQUIRED | Reuse Catalog `semanticDiffReview`; enforce requested-scope coverage, required-edit closure, and contract-preservation before approval/review. |
| Regression Test Generation | NEW INTEGRATION REQUIRED | Reuse `failureToTestTranslator` + `regressionTestGenerator` + `targetedRegressionStrategy`. Generated tests remain candidates until build/reliable-pass/strength gates pass. |
| False-pass Detection | NEW INTEGRATION / EXTENSION REQUIRED | Reuse Catalog `falsePassDetector`; add stronger checks for skip/deletion/assertion weakening/expectation drift/overmock/error swallowing and, where justified, mutation/coverage feedback. |

## 7. Reuse decision

The existing ModuleCatalog Code Repair & Verification Skill Pack is the primary reuse source for code-generation-specific additions. The known reusable functions include repository pattern reuse, cross-file dependency tracing, multi-file planning, synchronized patchset generation, context-aware contract codegen, compile-feedback repair, semantic diff review, test-impact selection, failure-to-test translation, regression-test generation, targeted regression strategy, test-failure interpretation, and false-pass detection.

These assets are not automatically trusted in DebugAI merely because they exist in Catalog. DebugAI must verify:
- exact asset/version identity;
- interface compatibility;
- target-language/repository applicability;
- current source binding;
- target-specific tests;
- no weakening of approval/security/evidence boundaries.

If a thin adapter is sufficient, prefer it over reimplementation.

## 8. Evidence and research separation

Observed or source-verified DebugAI behavior, deterministic local tests, Catalog asset tests, and target repository/runtime tests are implementation evidence.

External papers and agent designs are design evidence only. They may justify experiments or architecture choices but cannot prove the future DebugAI implementation works.

Relevant research directions retained as design evidence include repository maps, dependency-aware repository planning, iterative repository retrieval, graph-based localization, specification/intent extraction, build/reliable-pass/coverage filtering for generated tests, coverage-guided test generation, mutation-testing feedback, and benchmark/test-soundness warnings.

Any claimed improvement must be measured on DebugAI itself after implementation.

## 9. Failure and rollback behavior

A failed generation/repair attempt returns to the earliest invalid stage supported by evidence:
- missing/contradictory requirement -> requirement/intent stage;
- missing dependency/companion edit -> context/change-plan stage;
- compiler/type/lint failure -> compile-feedback repair;
- targeted regression failure -> diagnosis/change-plan repair;
- false-pass/test weakness -> test-generation/test-strength stage;
- semantic scope violation -> change-plan/candidate generation;
- insufficient evidence -> Researcher/evidence acquisition;
- reviewer rejection -> evidence-bound repair;
- unchanged failure with no evidence delta -> BLOCKED/NO_PROGRESS, not blind retry.

Existing durable continuation and candidate identity rules must preserve recoverability. No new state machine is authorized.

## 10. False PASS prevention

A code-generation result cannot be promoted based on any single signal such as:
- code was generated;
- code compiles;
- one targeted test passed;
- CI is green;
- Local Reviewer returned PASS;
- a reusable asset was previously verified elsewhere.

Minimum completion evidence for a code-changing task must be derived from the task and can include:
- required-edit closure;
- semantic diff within scope;
- compile/type/lint success where applicable;
- targeted regression success;
- adjacent/full-relevant tests when impact requires them;
- false-pass/test-strength checks;
- exact source identity;
- runtime verification when the claim is runtime-specific;
- evidence sufficiency;
- fresh-context review;
- existing Strict Completion requirements.

Verified(A) + Verified(B) does not imply Verified(A+B). Reused assets must be reverified after composition/adaptation in the target repository.

## 11. Acceptance tests for future implementation

The design is considered implemented only after at least these evidence classes exist:

1. **Deterministic unit/contract tests** for every integrated codegen gate.
2. **Cross-file repair fixtures** proving required companion edits are not omitted.
3. **Negative semantic-diff fixtures** proving out-of-scope edits and contract weakening are blocked.
4. **Compile-feedback loop tests** proving a real compiler/type/lint failure is localized, repaired, and rechecked.
5. **Regression-generation tests** proving generated tests fail before the fix and pass after the fix where applicable.
6. **False-pass tests** proving skip/deletion/assertion weakening/expectation drift/overmock/error swallowing are rejected.
7. **Source/runtime mismatch tests** proving stale runtime evidence cannot qualify a new source revision.
8. **No-progress tests** proving unchanged evidence/candidate/failure cannot consume infinite repair loops.
9. **Fresh-context review tests** proving the reviewer does not receive hidden producer reasoning or an authority shortcut.
10. **Strict Completion regressions** proving missing evidence remains BLOCKED/UNKNOWN.
11. **Real repository E2E** on multiple repository-change shapes, including multi-file and implicit-contract changes.
12. **Same-model A/B** comparing current DebugAI baseline vs reliability gates under the same task/model/settings.

## 12. Comparison metrics

Compare baseline and future path using the same task set and model/runtime conditions.

Primary reliability metrics:
- valid patch rate;
- required-edit recall / omitted companion edits;
- out-of-scope edit rate;
- compile/type/lint failure rate;
- targeted and relevant regression pass rate;
- false-pass escape rate;
- unsupported/overclaim rate;
- completion false-positive rate;
- successful repair after first failed candidate;
- no-progress loop rate.

Cost/latency metrics:
- model calls;
- tool calls;
- prompt/completion tokens;
- cache reuse;
- wall time;
- verification time;
- external search/reviewer calls;
- repeated work avoided by durable reuse.

Adoption rule: a gate that materially increases cost without measurable reliability benefit must remain conditional, be simplified, or be rejected. Reliability improvement must not be purchased by weakening existing evidence, security, approval, or completion gates.

## 13. Integration point in the current architecture

The current guarded DebugAI workflow remains authoritative. This delta inserts code-generation reliability work primarily around the existing Patch Engineer and deterministic verification boundary:

```text
... Diagnoser
  -> External Hypothesis Review
  -> codegen context + reuse + change-plan gates   [new integration]
  -> Patch Engineer candidate                     [existing owner]
  -> semantic diff + compile/type/lint             [new integration]
  -> targeted/adjacent/full-relevant regression    [new integration]
  -> false-pass / test-strength gate               [new integration]
  -> existing Master approval / apply boundary
  -> existing deterministic retest + invariants
  -> existing Local Reviewer
  -> existing External Final Review
  -> existing Strict Completion
```

The exact placement of pre-approval compile/test execution must preserve the current sandbox/candidate-only safety model. If candidate code cannot be safely executed pre-approval under the existing sandbox contract, those checks must remain read-only/static until the approved apply/verification phase. This design does not grant new mutation authority.

## 14. Current implementation status

As of this design delta creation:
- current DebugAI already contains the evidence, falsification, durable/no-progress, fresh-review, source-verification, approval, and Strict Completion foundations described above;
- the future Catalog code-repair Skill Pack has local deterministic/small-repository evidence but is not connected to the current DebugAI AI Core/runtime;
- same-model/same-temperature real DebugAI A/B for these future codegen skills is NOT_EXECUTED;
- Catalog/KB retrieval-to-DebugAI target adaptation remains a future integration boundary;
- this file authorizes no implementation, merge, deploy, production change, Catalog mutation, or KB mutation.
