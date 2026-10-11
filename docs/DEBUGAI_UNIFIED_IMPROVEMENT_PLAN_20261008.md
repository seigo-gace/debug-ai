# DebugAI Unified Improvement Plan — 2026-10-08

Status: ADOPTED DESIGN AUTHORITY / IMPLEMENTATION MAY PROCEED UNDER CURRENT GITHUB PROJECT RULES  
Target repository: `seigo-gace/debug-ai`  
Target branch: `feat/tgserver-async-log-sink-20261003`

## 1. Purpose

Improve DebugAI as one integrated debugging system, not as separate "investigation" and "code generation" products.

The product's established role is a reusable debugging/development engine invoked by parent AI, CLI and MCP integrations, not a stand-alone generator. Its final quality must include correctness on genuine repositories and how little human technical instruction is required for an evidence-bound investigation → diagnosis → candidate → guarded validation → repair/retest → review → Strict Completion cycle. Interface-specific availability must still be proven separately; this statement does not assert every integration is already live.

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

## 9. Revised rollout order — adopted 2026-10-08 second audit

The prerequisite order matters, but independent **read-only** investigations and tests may run in parallel. Do not impose a fully sequential waterfall when a risk-free isolated Change Unit can complete independently. Every mutation requires a source-bound gate, one owner, and isolated paths.

### Phase 0 — Authority + benchmark integrity
- Fresh GitHub Project / canonical Current / branch / PR / exact HEAD / CI / verified Runtime.
- Classify existing capabilities EXISTS/KEEP, EXISTS/IMPROVE, NEW INTEGRATION, DEFER, REJECT.
- Preserve the 50-investigation / 60-codegen historical controls and historical NO-RUNTIME / DEFERRED documents as history, not new prohibitions or success claims.
- Fix the test oracle and input identity before treating new measurements as improvements.

### Phase 1 — Shared execution/control foundation
- production prompt / validator / benchmark contract parity, strict shape and evidence binding;
- queue/role/tool/whole-workflow deadline accounting and failure-side telemetry;
- measured effective runtime model identity / n_ctx / chat template / sampling / thinking;
- use existing Model A/B, shadow-to-enforce with verified negative controls.

### Phase 2 — Investigation and diagnosis
- Role-only regression against fixed 50-case corpus;
- real read-only tool / source search / evidence reference integration;
- genuine repository-scoped end-to-end diagnosis, uncertainty and rejected-hypothesis checks;
- protect Causal Scout's measured baseline and prevent search false negatives from becoming negative facts.

### Phase 3 — Codegen construction and verification
- Requirement/Evidence Contract inside existing Patch Packet;
- exact BASELINE snapshot -> isolated candidate construction -> CANDIDATE snapshot;
- only THEN deterministic candidate preflight / language-specific syntax/runtime checks;
- semantic diff, test-strength, false-pass and bounded evidence-driven repair;
- preserve candidate-only / approval / exact-identity gating.

### Phase 4 — Real DebugAI dogfood / Strict Completion
- Use DebugAI's existing real permitted run surfaces to investigate its own actual faults;
- prove traceable source -> diagnosis -> candidate -> isolated test -> bounded re-fix -> regression -> fresh review -> Strict Completion;
- distinguish source/CI/sandbox/server Runtime and record unknown or blocked outcomes honestly.

### Phase 5 — Conditional performance / advanced reuse
- Evaluate Fast/Deep, normal output ceilings, bounded model-aware concurrency 1 vs 2 and prompt reduction only after the quality gates;
- integrate Catalog/KB and large archive/ZIP workflows when the exact target need and adapters are verified.

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

## 13. Adopted second-audit refinements — 2026-10-08

Source of Master approval: [Notion decision/readback record](https://app.notion.com/p/3f3cdcf128e481159b79f425cce96ba9). That record archives design intent; GitHub Current and live source/CI/runtime remain operational authorities. This section **supersedes rollout ordering** above any historical contrary sequencing in companion documents, but **does not override safety or approval contracts**.

### 13.1 Audit findings and precise gates
1. **Contract shape is not semantic correctness.** Existing `role-output-validator.js` uses permissive `expected_any` shape checks with shadow semantics by default. Extend the same canonical validator with required per-role keys/types/enums/evidence binding. Test negative cases and advance to enforce only after measured compatibility. Do not invent a second validator or claim that JSON mode is proof of task success.
2. **Evaluation layers must not be conflated.** Historical 50-case investigation measures mostly single-role execution with `toolRuntime:null`; it cannot certify real source search. Add fixed Role-only, real Tool-integration, and actual Workflow E2E qualification. Historical codegen benchmark with synthetic diagnosis/review passes is likewise not real debugging E2E. New holdout cases must not leak into prompts or reusable skills.
3. **Evidence handoff must preserve requirements.** Existing `makePatchPacket()` includes source revision, path and evidence fields but lacks an independently required structured contract of requested behavior, preserved behavior, forbidden changes, acceptance conditions, UNKNOWNs, boundary cases and tests. Extend this packet; bind requirement -> candidate edit -> actual test/evidence, reject missing/stale references. Do not add a new orchestration or handoff state owner.
4. **Snapshot construction precedes preflight.** Existing Sandbox actions center on `node.check`/package lint/typecheck/test/build; `copySnapshot` excludes generated/dependency directories and skips symlinks. Existing sandbox execution is not the same as a complete codegen construction workspace. First qualify exact baseline + candidate materialization, exclusion/metadata manifest and identity; only then execute generated candidate checks in the existing isolated sandbox, without pre-approval repository writes. If language-specific execution is unavailable, mark that check NOT_CONFIGURED/BLOCKED, not PASS. Archive/ZIP support remains a separately tested later transport option.
5. **Queue budget consistency.** `ai-core.js` supports queueTimeoutMs and excludeQueueFromDeadline for certain call paths; tool-loop and no-tool paths must have consistent, bounded interpretation of queue, model, tool and end-to-end deadlines. Preserve global serialization until measured concurrency 1-vs-2 results justify change.
6. **Model qualification requires actual identity.** Preserve current role/model assignments. Verify model artifact digest, quantization, runtime version, effective llama.cpp chat template, thinking mode, n_ctx, effective sampling and output ceilings. Official sampling defaults are *experiment candidates*, not blanket production configuration. A single-axis A/B should precede necessary combinations, and a temperature-0 top-p experiment alone may be uninformative. No policy/cost/model change without permitted authority.
7. **Safe accuracy gates.** False-pass negatives must catch deletion/weakening of tests, overmocking, error swallowing, wrong source snapshot and claims of unexecuted checks. Static AST heuristics alone cannot block valid code. Python bool/int/Unicode/hashability/mutation/boundary coverage is language/task-conditional.
8. **Measure the full distribution.** Track completion PASS/PARTIAL/FAIL plus timeouts, format failure, errors, retries, token data (null if absent), cold/warm model swaps, queue wait, prompt eval/decode, semantic correctness, holdout results and identity-linked run receipts. Do not compare successful-only averages or differing concurrency as if they were randomized A/B.
9. **Fastest practical delivery** means first proving a thin *real* debugging vertical slice (one actual in-scope defect closed with existing guarded approval), then stabilizing and extending coverage. Do not postpone functional dogfood for speculative model tuning, more skills, queue redesign or large ZIP features.

### 13.2 Tool and skill decisions
- KEEP existing 6 roles, RunAuthority, Evidence, Tool Loop, skills, Model A/B, guarded MCP/Server/GitOps, Sandbox, review and Strict Completion.
- Improve existing source read/search/symbol/dependency capabilities; add Search Coverage Receipt/explicit truncation where search limits can hide files. Do not call 0 hits an exhaustive negative unless coverage proves it.
- Prefer workflow-owned mandatory candidate verification to a model-optional tool.
- Add `spec-contract-audit` or `python-edge-semantics` only when minimal prompt/fixture experiments demonstrate a missing capability; enable Python checks only for Python tasks.
- No duplicate Reviewer/Orchestrator/State Engine, arbitrary Tool permissions, unconstrained agent swarms, unsupported model swaps, or routine paid external review.

### 13.3 Completion and safety acceptance
- Maintain current protected gates: candidate != apply; source/CI != live Runtime; exact Candidate + source/snapshot identity and permission before any mutation.
- All meaningful failures must preserve a precise UNKNOWN/BLOCKED state and evidence ID; failures in tool/runtime/CI may not be turned into success summaries.
- No phase is COMPLETE merely because its documents, tests, CI or benchmark-only run pass; real validated source/runtime closed loop is the product acceptance boundary.
- A parallel Cursor agent or DebugAI self-dogfood runner is subject to **the same** GitHub Project and Server AI Minimal Kernel, repo scope, approval, secrets and verification conditions. The GPT CHAT Rule Plane stays out of server-side agent context.

## 14. Codex execution handoff — 2026-10-09

Master explicitly paused GPT CHAT product Source mutations and delegated further DebugAI implementation and routine technical decision-making to VS Code Codex. The [Codex integrated product execution design and exact handoff](CODEX_UNIFIED_PRODUCT_EXECUTION_DESIGN_20261009.md) is the checked-in operating **addendum** for the next Codex session. Codex must read it **together with** this plan, especially the superseding adopted second-audit §13, the investigation master, Codegen Reliability/Sandbox Snapshot/5V design deltas, SERVER_AI Current Rule #16 and actual GitHub Project/Issue/PR Source/CI evidence. It does not supersede safety, protected approvals or product architecture, and does not itself mark Source/CI/Runtime/merge/deploy as complete.

The last ChatGPT-verified product Source chain ends at PR #65 `504fce8af8139f0fde546ab4ba494524fb8e9c91` (OPEN/READY/UNMERGED, 564/564 and four applicable exact-head workflows PASS); §14 is a handoff reference in a **separate documentation-only branch**. Codex must fresh-check heads/owners and resume at the next product gate (actual preapproval candidate language-specific validation and genuine end-to-end diagnosis/codegen quality), not repeat implemented PRs, not switch into unrelated Host/Workspace inventory, and not assume CI equals model-semantic quality.

**Repository-local design preservation — Master correction (2026-10-09):** Codex has **no Notion connector**. The checked-in [DebugAI Product Decision Context](DEBUGAI_PRODUCT_DECISION_CONTEXT_20261009.md) contains the decision-critical historical rationale, accepted/rejected/deferred approaches, research evidence strength and open assumptions migrated for Codex use; this adopted plan remains the design authority. Codex must re-read both it and the [Codex execution design §8–§9](CODEX_UNIFIED_PRODUCT_EXECUTION_DESIGN_20261009.md) at relevant Gate/CU entry. Maintain implementation-specific decisions and evidence-backed design changes in the existing applicable **repository design/Delta on the same PR/branch as code**, verify remote readback, and link exact commits/tests/CI to GitHub Current #41 and chronology #42. Notion is optional historical provenance for other authorized actors, never a runtime/input dependency or a substitute for repository design. Technical selection within the adopted purpose remains Codex-owned; normal Master technical review is not required.

**Master's 2026-10-09 technical-autonomy clarification:** Codex owns routine technical decisions and execution end-to-end (research, architecture-internal method selection, feature-quality/performance optimization inside the adopted product scope, code/test/CI/benchmark fixes, and evidence-based Design Delta). Master is not a technical approval oracle. An alternative with measured equal-or-better requirements coverage, effectiveness, correctness, reliability, speed/resource or cost efficiency and no safety regression may be selected by Codex without requesting a routine Master choice. Preserve explicit product-intent, materially changed user-visible semantics, irreversible state, secret/security/public exposure, new significant spend/provider/model, merge/deployment and other protected Host/Current gates. The detailed operating/continuation contract is §9 of the linked Codex execution addendum.

## 15. Adopted GitHub Actions Artifact ingestion — Master decision 2026-10-10

Decision: On-demand first. GitHub Actions failure Artifacts are core DebugAI diagnosis evidence; persistent heavy analysis daemon, new queue, MCP, workflow, token, provider or paid path is not authorized. Later event-based intake may reuse existing Actions/webhook infrastructure only after admission and measured need.

Architecture and ownership: GPT CHAT owns artifact/run metadata admission, safe ZIP intake, Evidence Registry provenance and TGserver ZERO linkage. Codex owns Scout/AI Core latency, telemetry and successful-stage reuse; no overlapping Scout changes. Reuse existing github.gh_read/API, RuntimeEvidenceStore, registered Evidence IDs and TGserver ZERO producer. The Sandbox native-addon artifact provisioner is unrelated.

Minimal implementation contract:
1. Accept an authorized repository and Run ID (optional artifact selector); fetch workflow/run/attempt, event, job and conclusion, exact head SHA, artifact ID/name/size/created/expires, and PR or Issue only if the API actually supplies them. Enforce registered owner, repo, Project and read-only scope. Never infer a missing association.
2. Fetch a bounded selected log/test artifact by immutable Artifact ID via the existing authenticated GitHub read-only route; pin repository/run/attempt/SHA and verify supplied sizes and digests. Enforce strict download byte/time/entry limits and reject missing/expired/mismatched or unauthorized objects. Artifact retrieval is never a CI PASS.
3. Parse ZIP before extraction, non-executably. Fail closed for absolute/traversal/drive/backslash-ambiguous paths, control chars, duplicate normalized entries, symlinks/hardlinks/device entries, nested archives, encrypted/password entries, unsupported compression, malformed CRC, truncated contents, too many entries, decompression ratios/bombs or excessive depth. Decompress only allowlisted text logs into private isolated storage, never repo/host/runtime executable paths. Listing with unzip -l is not a complete safety gate.
4. Sanitize tokens, cookies, authorization, passwords, credentials and .env values before model prompts, user displays or ZERO emission. Reuse RuntimeEvidenceStore record-byte cap, default retention/GC and secret masking; do not create S3/independent store. Bound excerpts; hold SHA-256 digest and manifest for each accepted entry.
5. Register each sanitized accepted entry with immutable provenance: repository, run_id, attempt, workflow_id, job_id, exact head_sha, artifact_id, entry_path, content_sha256, received_at, and actual observed PASS/FAIL/UNKNOWN. Link registered Evidence IDs to Diagnoser claims and ZERO development-log producer; missing evidence remains UNKNOWN, not negative proof.
6. The intake is read-only and data-only. Artifact text is untrusted input, never tool instructions, rule/approval overrides or execution authorization. No silent patch/apply/deploy, new reviewer/provider, or external API consumption. Optional later existing-event trigger must be idempotent, quota bounded and separate from heavy worker lifetime.

Acceptance: A. authorization + metadata; B. adversarial ZIP negative fixtures; C. digest/provenance/redaction/TTL regressions; D. one actual failed GitHub Actions Artifact -> admitted Evidence IDs -> bounded Diagnoser input -> TGserver ZERO correlated producer/readback, without provider calls; E. optional event activation via an existing approved path. Keep exact Source/CI/Host/Runtime evidence distinct. Broad 50/60/100 and complete real defect Dogfood come after improvements; an Artifact ingestion E2E is not complete DebugAI Strict Completion.

Status at adoption: Actions artifact generation, authenticated read surfaces, existing runtime evidence retention/masking exist. DebugAI-owned Artifact ZIP validation and end-to-end automatic Evidence admission are NOT_VERIFIED. This is an adopted design requirement, not an implementation completion claim.

### 15.1 Codex Artifact Change Unit — implementation delta 2026-10-10

Master's subsequent explicit Artifact delegation supersedes the section 15 ownership sentence: Codex owns Actions acquisition/ZIP/provenance/Evidence entrance/ZERO correlation; GPT CHAT continues owning Workflow/Patch/Sandbox/refix and overall integration. Base is Current integrated executable Source `906470b9ad438da2c032562b7de5d73b16c2dad7` (PR93), preserving every existing owner change; design adoption is copied from PR92 `aab0575f5a2074b83dc4d367d1a1aa92cc4ea10e`. No PR92 source mutation.

Reuse decision: `github.gh_read` returns capped text through command substitution and cannot safely carry ZIP bytes. `actions-artifact-github.js` therefore calls the existing authenticated Host `gh api GET` with fixed GitHub host, fixed endpoint construction, 30-second per-call timeout and bounded buffer. No new token or transport credential. The on-demand script reads the existing private admitted registry (owner UID/0600/nonsymlink/single-link), freshly verifies GitHub principal/admin/repository numeric+node identity and Project item. Registration is a target scope check; deploy branches/paths grant no new read or reflection permission. Explicit Master Artifact request supplies this read scope. Missing authentication/Project membership stays blocked.

ZIP parser: memory-only, 4 MiB download, 128 entries, 2 MiB per entry, 8 MiB total, ratio <=200, depth <=8. Accept only UTF-8 `.log/.txt/.json/.xml/.tap/.junit`. No extraction or execution. Strict local/central names, offsets, flags, size/descriptor, decompression consumption and CRC checks; contiguous layout, no preambles/trailing payload/multidisk/ZIP64/unsupported features. Reject traversal/absolute/drive/backslash/control/noncanonical/ambiguous/duplicate paths, unsafe extensions, symlink/device types and link-bearing extra fields. Lower support is deliberate fail-closed compatibility, not implicit support for every GitHub artifact.

Provenance: require completed exact Run/attempt/SHA, same owning head repository, selected artifact immutable ID/digest/size/expiry, complete bounded attempt-job metadata. Fresh-read Run and Artifact again after download to reject a concurrent rerun/expiry/change. GitHub supplies no artifact-to-attempt or job identity: currently only first attempt accepted; `job_id=null` and job association UNKNOWN, actual observed jobs retained separately. No inferred PR/Issue links or root cause; entry observed outcome UNKNOWN while actual Run/job conclusion remains its own fact. Rerun support needs a real authoritative association and is explicitly NOT_CONFIGURED.

Reuse RuntimeEvidenceStore private record/byte cap and configured default retention/GC; raw archive never persisted. Artifact-specific scrub adds private keys, known credential formats, Basic/cookie headers, quoted secrets and dotenv assignments on top of existing masking. Raw content SHA is an integrity identifier, never an excerpt. Registered EVI payloads plus bounded Evidence projections are written as `github_actions_artifact`. `loadArtifactEvidence(store,run,ids)` requires retained hash-valid IDs and produces existing `localEvidence`; normal Workflow re-registration preserves IDs. No Workflow, Sandbox or runtime-packets edits. Existing Diagnoser Tool Loop accepts registered actual artifact records with a deterministic local callback; no claim of real-model root-cause correctness. Existing TGserver `log` queue and `/search` correlation are reused, with separate delivery stats; accepted/indexed != durable archive completion.

Rollback: stop using the on-demand script or revert these isolated additions. No persistent worker/MCP/Workflow/provider/model/ledger/Secret/runtime-setting changes. Branch/worktree owner and cleanup owner Codex; isolation inside canonical `/home/admin1/projects/debug-ai/.worktrees/actions-artifact-20261010`, no new top-level sibling. Exact Source/CI and pending Host readback belong to this PR/#41/#42 rather than the old deployment notes.

§15.1 qualification checkpoint: clean Source eb44e26 remote9/9, exact7/7 CI, normal+real sidecar776/776 and focused53/53. Real Artifact acquisition/EVI/local diagnosis-input/ZERO index slice PASS; production store/runtime reflection and durable-archive completion remain open. Detailed Source/CI/Host/runtime distinction and technical-owner handoff are retained in ZERO Evidence§7.2. No design promise is upgraded to production PASS.

### 15.2 Practical integration and existing Actions reflection boundary — 2026-10-11

Codex integrates exact owner Sources PR92 `0cd5052`, PR96 `0925822`, and PR95 `ba0b441` without rewriting their implementation. Reuse the existing owned Scout checkout/branch, because reflecting PR92 alone would discard Tool B changes in the canonical checkout. Source conflicts affect only overlapping adoption/qualification documentation; preserve both design and measured history. Focused Artifact/Diagnoser/GC tests: 46/46 PASS, no provider calls.

The existing CHAT Actions workflow admits one fixed Codex control branch `fix/codex-debugai-live-20261011`, paired only with the already admitted deployment branch `fix/scout-observation-reuse-20261010`. It uses the existing Master Internal receipt/API/Host Compose boundary and exact remote SHA equality. Other trigger/target pairs remain denied, and existing Tool B behavior stays intact. A separate control commit is required because embedding its own commit SHA is impossible and mutable targets are denied. This is a small existing boundary extension, not a new workflow/transport/worker; no token, provider, ledger, model or role changes.

Rollback through the same guarded reflection to the previously qualified Source; preserve volumes and owners. Source/CI/Host packaged parity and actual same-Run Dogfood results must each be recorded separately. Artifact CLI remains on-demand and data-only, and no Source CI proves model-semantic or Strict Completion success. Cleanup owner Codex; reused nested checkout, no new parent.

Integration CI exposed two pre-existing PR96/target compatibility failures: Host file-inspect hardcoded roots replaced the explicit fixture override, and scope-negative tests depended on an optional global command now absent from the live target. Preserve the Host-root override with the same canonical production fallback, and make scope-negative tests supply an actual allowed command explicitly. No allowlist, command or file-read boundary is weakened. Same real Bash/jq file-inspect fixture and model-independent scope negatives are rerun before reflection.

§15.2 live qualification checkpoint: production safe Artifact→retained EVI→existing local diagnostic input→ZERO indexed correlation was measured at exact d39ed3e, with zero model/provider calls; see ZERO Evidence§7.3 for exact acquisition, hashes, Source/CI/Host/runtime and concurrent supersession. A subsequent other-Owner deployment removed the feature from current runtime, so current availability is still pending the Owner-preserving PR97 reflection. The full practical debugging loop remains under actual same-defect model testing; terminal BLOCKED resumes are not bypassed or treated as successful.

§15.2 current runtime qualification: Owner-preserving Source24bf1b838710fe94b0b8a14575cdc8dd527cb5ff, exact CI7/7 and real isolated786/786, admitted existing Actions38104770003/Host gitops_ce8b3de97de495ef19ebaba3 PASS, packaged300/300 per container, real failed Artifact→production EVI→existing local diagnostic input→ZERO correlation verified. Exact proof/limitations in ZERO§7.4. Broader same-defect practical model Run remains Diagnoser BLOCKED; no whole-product Strict Completion or durable-archive PASS is inferred.

### 15.3 Master scope correction: product-only DebugAI integration — 2026-10-11

Master assigns Codex only DebugAI; no server-core changes, push or reflection. Reuse the verified common migration as external ownership, remove its duplicated generic CHAT client/tests and cross-project/read/dogfood/source-reflect dispatch from DebugAI's existing live workflow. Retain only fixed DebugAI product deployment through existing Actions/Host admission and exact runtime readback; no new workflow or transport. Keep current API/MCP Host execution boundaries/registries because existing DebugAI tools and the externally owned common client depend on them. Do not remove working runtime contracts simply because their frontend moved. Migration tests qualify product scope, existing Host request/runner compatibility, canonical CI and actual reflection. Rollback is a normal Source commit through the same admitted path. Product diagnosis timeout work proceeds independently under P0-B/P0-C and §13, preserving role/model/budget/Strict Completion/free-quota contracts.
