# DebugAI — Repository-local Product Decision Context (2026-10-09)

Status: DECISION RATIONALE / RESEARCH CONTEXT / EXPLICIT UNKNOWNS. **Not a competing live Current, runtime qualification or new implementation authority.**
Owner: `seigo-gace/debug-ai`; intended reader: VS Code Codex / other authorized DebugAI product executors.
Master confirmed **Codex has no Notion access**. This checked-in record carries the decision-critical background needed to execute the adopted design **without fetching Notion**. Past Notion URLs below are provenance only, never required runtime inputs.

## 1. Canonical separation and mandatory design reads

- **Operational Current / CU / owner / Gate:** live GitHub Project `G-ACE Development Platform #1`, DebugAI [#41](https://github.com/seigo-gace/debug-ai/issues/41) and [#42](https://github.com/seigo-gace/debug-ai/issues/42), verified current branch/PR/CI and Host evidence. This historical decision record NEVER pins current HEAD, ownership or a later Gate.
- **Approved product design:** [`DEBUGAI_UNIFIED_IMPROVEMENT_PLAN_20261008.md`](DEBUGAI_UNIFIED_IMPROVEMENT_PLAN_20261008.md), especially adopted §13 and Codex handoff §14. **Execution contract:** [`CODEX_UNIFIED_PRODUCT_EXECUTION_DESIGN_20261009.md`](CODEX_UNIFIED_PRODUCT_EXECUTION_DESIGN_20261009.md), including §5–§10. Preserve [`INVESTIGATION_VERIFICATION_IMPROVEMENT_MASTER.md`](INVESTIGATION_VERIFICATION_IMPROVEMENT_MASTER.md), [`CODEGEN_RELIABILITY_DESIGN_DELTA.md`](CODEGEN_RELIABILITY_DESIGN_DELTA.md), [`CODEGEN_SANDBOX_SNAPSHOT_DESIGN_DELTA.md`](CODEGEN_SANDBOX_SNAPSHOT_DESIGN_DELTA.md) and [`CODEGEN_5V_RCCA_FOUNDATION.md`](CODEGEN_5V_RCCA_FOUNDATION.md) where the owned CU touches those boundaries.
- **Source truth:** actual checked-out code, tests, PRs and exact-head CI. **Runtime truth:** explicit admitted Host/runtime readback. **Decision history:** this file and relevant existing repository design/Delta. Neither unverified literature nor old Notion snapshot is product performance evidence.
- **Mandatory recurring workflow:** At every meaningful Codex resume and **before material design decisions**, read the affected sections of this document and the adopted plan; inspect existing related source/test/delta. If they conflict with fresh Master intent/Current, mark CONFLICT with exact evidence and stop only the dependent mutation. No external Notion login, manual copy/paste, Master notes or unavailable connector is required.

## 2. Fixed product purpose and Master decision

DebugAI is a reusable debugging/development engine for authorized parent AI / CLI / MCP pathways, **not** two separate investigation and generation products. The intended end-to-end user outcome is real repository intake → bounded read/search and evidence → causal diagnosis and requirement/evidence handoff → Patch Engineer candidate → isolated baseline/candidate snapshot → language-appropriate deterministic tests → bounded re-fix on fresh failing evidence → independent Reviewer → Strict Completion → protected apply/Runtime only when authorized. Integration availability must be proven per surface.

Master is nontechnical and delegates **all routine technical judgement and execution** to Codex inside the accepted scope, including evaluation and adoption of demonstrably superior technical alternatives. Do not ask Master to choose branch, technique, test, algorithm, code or a better-performing qualified method. Protected decisions remain protected: product purpose/material user-visible scope, irreversible data, security/Secrets/public exposure, significant new provider/model/spend, and explicit merge/deploy/Host gates. A technical superiority claim cannot override those protections.

Do not optimize for more features at the expense of correctness; `minimum` means removing redundancy without dropping required capabilities. Preserve existing six roles, RunAuthority, Evidence/Tool Loop, guarded PatchCandidate, Sandbox/Sidecar, Review, Strict Completion, durable execution and bounded MCP/Host safety.

## 3. Why the unified improvement was adopted (2026-10-08 decision)

The original independent evaluation exposed both **diagnosis** and **code generation** quality problems. Investigation historical baseline: 21/50 DONE (18 timeout, 9 format, 1 budget, 1 HTTP); among DONE 14 PASS/5 PARTIAL/2 FAIL semantic. Codegen semantic PASS 25/60, MISS 26/60, format failure 9/60; a separate candidate 42/50 measurement is NOT equivalent to a real repair E2E. The first Code Scout benchmark had a production-output contract mismatch, so 0/10 is not clean model evidence. Success-only latency/queue averages must not be compared as overall throughput. Exact source/runtime/model/conditions and failure distributions matter.

Adopted conclusion: improve **AI control** (role contracts, model-specific invocation, context and tool/skill selection, Evidence handoff, output contracts) and **execution control** (queue deadlines, telemetry, snapshot, sandbox verification, repair and completion) **together**. New skills/LLM settings alone cannot repair broken evidence and test boundaries. Existing mechanisms are the first reuse candidates.

## 4. Adopted design decisions and explicit reasons

1. **Existing responsibility owners stay in place.** Expand the canonical Role validator / invocation compiler, `makePatchPacket`, Source tools, PatchCore, Snapshot, Sandbox verification and Evidence; do not create duplicate Orchestrator, Reviewer, schema/state engine, sandbox or unchecked tool authority.
2. **Contract correctness is not semantic correctness.** Strict role shape/type/evidence admission and independent real-source outcome are separate gates; shadow warnings cannot silently become real PASS.
3. **Snapshot before verification.** Exact BASELINE identity → safe copied CANDIDATE with bound edits/manifest → check actual modified code in isolated Sidecar → review and only authorized apply. A source-only test or simulated role cannot establish generated-candidate success. Missing deps/language support = NOT_CONFIGURED/BLOCKED, never PASS. Preserve fail-closed symlink/path/Secret controls.
4. **Failure-driven bounded repair, not uncontrolled loops.** Refix receives fresh error/test/output/snapshot evidence, enforces scope, rejects disappearing tests, overmocking and weakened assertions. Same unsupported failure repetition must terminate/escalate.
5. **Role/model qualification needs true artifact/settings.** Preserve existing six-role assignments until measured role-aware experiments justify change and appropriate provider/model authority exists; distinguish format, thinking, model, queue and Tool defects. One-variable tests before targeted combinations.
6. **Measurement must include actual work.** Historical 50 investigation and 60 codegen corpora are fixed controls; add independent holdouts, read-only real-repository diagnosis, actual patch candidate execution and complete repair E2E. Track false PASS, semantic PASS/PARTIAL/FAIL, retries, cold/warm queues, wall time, token/time unknowns and cost without cherry-picking successes. Track human technical instructions needed to close defects correctly.
7. **Reuse is evidence-bound.** Catalog skills (13 existing Code Repair & Verification Skill Pack) and G-ACE KB are discovery sources, not automatic trusted executable patches. Catalog → KB discovery → exact asset hydration/resolution → target-repo contract verification → candidate; verified generated output feeds a Catalog candidate, NOT automatic self-learning KB pollution. Preserve current asset owners and no unauthorized cross-repo mutations.
8. **Tool intensity follows evidence/risk.** Prefer native compiler/lint/typecheck/tests, source search/AST/LSP, dependency facts and small observable pipeline before heavy mutation/property/symbolic tools or extra LLM agents. Do not transplant a publication's benchmark score to this product.

## 5. Decisions explicitly rejected / conditional / postponed

**REJECT**: obsolete interpretation that codegen must wait indefinitely until all investigation issues vanish; only codegen pipeline without diagnosis; immediate model replacement; six-role rebuild; duplicate core components; arbitrary shell/network/Secrets; unconditional extra tool calls, loop rounds or subagents; replacing model semantic tests with JSON-shape/coverage/self-review alone; dynamic KB reuse without exact target verification; blanket formal proof/model checking for every asset; paper scores as achieved DebugAI metrics; treating search Top-1 as authorized code to apply; blanket queue removal; autonomous apply/merge/deploy.

**CONDITIONAL/DEFER**: larger ZIP/archive workflow, Catalog/KB exact hydration adapter, additional language Skill (e.g. Python-specific semantics), Fast/Deep routing, increased concurrency, output ceiling changes, advanced 5V verification, heavyweight mutation/Z3/differential verification, new indexers. Trigger only from measured missing capability and an authorized scope/cost/safety gate. An earlier research document proposing a tool or server bridge does **not** authorize building a duplicate transport or installing it.

**KEEP**: bounded existing DebugAI MCP/Host, parent project ownership, explicit single CU writer, exact SHA/effects/approval and private Docker-compose Runtime; no sibling project directory outside verified canonical parent.

## 6. Research origins and strength of evidence

Historical decision sources consulted and interpreted into this repository-local record:
- [2026-10-08 accepted unified design audit / rejected interpretations / 2026-10-09 Codex delegation](https://app.notion.com/p/3f3cdcf128e481159b79f425cce96ba9): accepted intent and decision rationale, **not** current GitHub HEAD or Runtime.
- [2026-10-03 internal assets, reuse, tools and paper survey](https://app.notion.com/p/3eecdcf128e48127b740da7322543841): comparison **hypotheses** and internal asset references, not automatically executable qualifications.
- [Original DebugAI historic authority](https://app.notion.com/p/3e4cdcf128e481fb9c90f39ede1092c2): product background, superseded for day-to-day Current.
- Representative ideas considered: Aider repository map; SWE-agent structured tool interface; Agentless observable localization→repair→validation; CodePlan dependency-aware planning; RepoCoder retrieval; SpecRover spec-aware repair; TestGen/CoverUp test strengthening; compositional verification principles without blanket formal method adoption. Consult official sources **only when technically necessary**; do not assume these claims prove a DebugAI improvement.
- The former Catalog 13-skill pack had reported **small targeted source tests (37/37 and 3,000 invariants)**, but equal-model current DebugAI Skill-OFF/ON A/B was **NOT_EXECUTED**. Treat that historical result as reuse evidence, not final model performance proof.

## 7. Open unknowns and completion boundary (decision context, not Current)

At the Codex product handoff, real live-model Code Scout→Diagnoser→Patch Engineer→generated candidate→language-native checks→Review/Strict Completion was NOT_VERIFIED; whole-tree completeness and candidate dependency admission were NOT_QUALIFIED; matched 50/60 semantic delta, actual time/cost gain and full Runtime reflection were NOT_MEASURED. Read current #41/#42 and PR/CI before choosing the next CU; these historical observations must never override newer proof. In particular, PR #56→#59→#60→#63→#64→#65 was a stacked unmerged Source baseline at the 2026-10-09 checkpoint, not an instruction to redo completed work.

## 8. Repository decision persistence — must be followed by Codex

- **Before an owned Change Unit:** verify fresh Project/Issue/HEAD/PR/CI, then read the relevant adopted plan/decision-context, existing feature design, Source and tests. Record G1 gap and competing approaches only if materially needed. Unknowns stay unknown.
- **While implementing:** choose the soundest method; for meaningful design changes that deviate from or extend the accepted plan, update the existing relevant design/Delta, documenting baseline, rationale, accepted/rejected alternatives, interface/ownership/dependency/safety effects, measurable acceptance/rollback and limitations **in the SAME owned branch/PR as the corresponding implementation**. Do not create a parallel design owner or a pile of redundant planning documents.
- **At G3:** check the committed design matches the code and actual tests. Record path+exact SHA, test/CI/runtime distinctions and next exact gate in GitHub #41/#42 and perform remote readback. **No Repo design readback = design update NOT_VERIFIED**; no CI/mock-only claim of real semantic completion.
- **If no design delta:** explicitly state why current design was unchanged, link existing section and the demonstrated outcome. Do not rewrite accepted design just to match temporary implementation.
- **Notion is not a dependency for Codex.** If its connector is unavailable, **do not attempt Notion access, stop for user copy/paste or mark the GitHub design incomplete**. Work from this checked-in context and repository canonical design. Record new reasoned decisions in the Repo and GitHub, not in an unreachable Notion page. Optional later Notion archiving by another authorized actor is separate and never substitutes for the committed Repo design.
- If a relevant historical premise is NOT actually captured here, identify that *specific gap* in #41/#42 with source/context/impact and continue unaffected approved work. Do not invent a historical decision. Ask Master only for a genuinely protected **product intent** choice that blocks that specific action, not a technical decision.

No Secrets/private raw logs/hardcoded credentials in this document. The references are provenance, not permission to expand execution scope.
