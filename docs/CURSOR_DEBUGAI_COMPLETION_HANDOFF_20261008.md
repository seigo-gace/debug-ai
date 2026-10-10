# Cursor → DebugAI Real-World Completion Handoff — 2026-10-08

Status: **MASTER-DIRECTED EXECUTION ORDER / COST-CONSTRAINED**  
Owner of product/technical orchestration: ChatGPT GPT-6; Cursor execution: Composer only by default; Master relays bounded instructions/results.  
Repository: `seigo-gace/debug-ai` — source branch `feat/tgserver-async-log-sink-20261003`; integration PR `#40` **DRAFT / UNMERGED** at preparation. **Never trust a recorded HEAD as fresh.**

## 0. Entry, source-of-truth and authority

**You are instructed to drive DebugAI to actual end-to-end practical completion, not to write another speculative redesign.**

Before modifying anything, fresh-read in this order:
1. `G-ACE-inc/server-core/README.md`, `docs/LOAD_SCOPE.md`, `operations/github-project-rule-plane.json` for minimal bootstrap;
2. **SERVER_AI** Minimal Kernel [server-core Issue #16](https://github.com/G-ACE-inc/server-core/issues/16); **NEVER** load the CHAT-only Issue #17 into Cursor/server agents;
3. [GitHub Project #1](https://github.com/users/seigo-gace/projects/1) Current, canonical [DebugAI Issue #41](https://github.com/seigo-gace/debug-ai/issues/41), and current repository `AGENTS.md`;
4. `README.md`, `docs/CURRENT_STATE.md`, `docs/CURRENT_SOURCE_QUALIFICATION.md`, `docs/PROJECT_TREE.md`; `docs/DURABLE-CONTINUATION-DESIGN.md` only if relevant;
5. `docs/DEBUGAI_UNIFIED_IMPROVEMENT_PLAN_20261008.md` **including adopted second-audit section 13 and revised section 9**; read the referenced four specific existing designs only when working on them;
6. fresh target Branch SHA / actual PR base+head / exact SHA CI / relevant source and tests; if runtime is involved, obtain direct current runtime HEAD/health/identity evidence.

Use current sources over historical Notion/head records. [Notion adopted design-audit record](https://app.notion.com/p/3f3cdcf128e481159b79f425cce96ba9) is supporting decision context, not GitHub Current or live-runtime authority.

**Master's intent:** practical completion ASAP, minimal external AI cost, no feature reduction, no unrelated implementations, no second orchestrator or redoing completed work. Protected actions must still obey existing exact-SHA/scope/approval/Host gates. Do not prompt Master for routine technical choices.

## 1. Composer-only by default — Master-approved operating mode (2026-10-08)

**GPT-6 CHAT is the sole development coordinator; Cursor Composer is the only routinely invoked paid editor/implementer.** Master copies the bounded instruction from CHAT into Composer, and returns the Composer implementation report to CHAT. GPT-6 independently checks GitHub repository Current, code, diff, CI, issue/PR, and available existing GitHub-triggered real-server evidence; it directly performs safe connected-source edits when possible. Composer is used only for actual workspace, MCP, server-read, Test or implementation steps CHAT cannot complete directly.

The existing Cursor model/subagent configuration stays intact and **idle**. Do not automatically call Cursor parent Sonnet/Cursor AI, Gemini Flash, lightweight GPT, extra Composer agents, or Cloud Agents. Any additional agent is an **explicit exceptional delegation** from CHAT when narrow evidence proves that Composer + existing deterministic/DebugAI tools cannot close a specific blocker; no automatic multi-agent fan-out or paid provider/model change.

| Executor | Routine duty | Boundary |
|---|---|---|
| GPT-6 CHAT | Fresh Current, source analysis, design/CI checks, action plan, direct GitHub operations and analysis of Composer results | GitHub connector and existing verified GitHub-triggered routes only; not a fictitious directly mounted DebugAI MCP |
| Master | Copy CHAT instruction to Composer; return Composer report to CHAT | No routine VPS commands, troubleshooting or technical decisions |
| Cursor Composer | Execute *only the latest assigned Change Unit*, run focused/canonical tests and real DebugAI MCP/CLI operations where available | Existing SERVER_AI minimal rule-plane, repository paths, model/account budget, Master protected gates |
| DebugAI | Existing real read-only investigation, evidence-bound diagnosis, candidate generation, verification and bounded refix | Current authorization and verified server/runtime identity; no automatic apply/merge/deploy |
| Sonnet / Cursor AI / Gemini Flash / GPT design helper | **Not routinely used**; retained as optional configured tools | Only if GPT-6 requests a specific needed operation, with bounded spend |

**Cost protocol**
- First use existing source/logs, static read-only checks, GitHub CI and already verified DebugAI infrastructure. Avoid expensive 50/60 model benchmark reruns until a targeted need and run budget are established.
- GPT-6 performs all GitHub/Current/CI/design work possible without Composer; Composer receives one small concrete instruction at a time, not entire research handoffs.
- A Composer result must report exact source HEAD, test/run IDs, source-vs-live SHA, evidence, blockers and next gate. Return the report to CHAT; GPT-6 decides the next Change Unit.
- Read-only tasks can run next to one Composer write only when safely independent. Never introduce overlapping writers or change the user's Cursor settings.
- Existing master-only persistent delegation and 13-tool DebugAI MCP are **verified as server-side capabilities**. This ChatGPT session's direct DebugAI MCP mount is **not verified**; prefer existing GitHub→authorized server read-only workflows for CHAT-visible evidence and Composer/MCP only for the unexposed live operations. Do not build a new execution transport.

## 2. Exact next steps — optimize for actual working DebugAI

### G0 — Fresh Current and authority reconciliation (first, fast)

- Identify exact current branch, open PR #40 base/head, approved live server SHA, source-vs-server divergence, CI and present Work/Project Gate.
- Confirm prior merged Master-only persistent delegation is **separate** from open unified-product PR #40. Never mutate the commercial/legacy full-approval path.
- Confirm the adopted design doc's section 13 exists at fresh source; identify any remaining older `DEFERRED` references as historical vs operative.
- Produce a minimal CHANGE MATRIX `EXISTS_KEEP / EXISTS_IMPROVE / MISSING_INTEGRATION / DEFER / REJECT` from actual source; skip completed items.
- **Exit:** Current and exact intended Change Unit anchored; no ambiguous branch/runtime assumptions.

### G1 — Contract+telemetry reliability (bounded edits)

- Preserve already-implemented Code Scout benchmark/production contract parity and codegen terminal telemetry persistence. Do not redo those commits.
- Verify actual `role-output-validator.js` shadow vs enforce behavior; design per-role required keys/types/enum/evidence refs using the *existing* validator, with negative fixtures and staged failure-safe activation. Do not treat JSON-only as semantic PASS.
- Normalize Queue wait, model execution, Tool Loop, total wall deadline accounting across tool/no-tool paths **without unbounded timeouts**.
- Preserve failure-side telemetry (timeout/format/length) without leaking secrets or raw chain-of-thought; missing metrics remain null/UNKNOWN.
- Runtime-effective config identity: version/model artifact digest/quantization/template/context/sampling/thinking. Use current Model A/B scaffolding, no immediate model switch.
- **Exit:** exact-head focused+canonical tests/CI, failure-class tests, no Causal Scout regression. Source-only PASS remains source-only.

### G2 — Investigate for real (can begin read-only alongside G1)

- Historical 50 cases are baseline; verify role-only and tool-enabled cases **as different modes**.
- Add/qualify source-search coverage receipt, query truncation, true NOT_FOUND vs NOT_SCANNED; preserve known Python/JS language coverage boundaries.
- Exercise DebugAI itself through its **currently available, qualified** MCP/CLI to investigate one real existing DebugAI defect, not a synthetic fixed prompt. If Cursor cannot invoke the MCP, report which registration/tool/transport gate is missing with evidence rather than inventing completion.
- Save actual Evidence IDs, source SHA, diagnosis status, rejected hypotheses, UNKNOWN and time budget. Don't call diagnosis success just because a role returned JSON.
- **Exit:** at least one real source-bound investigated issue; holdout cases protected.

### G3 — Construct and verify a real candidate (critical product path)

- Extend existing `runtime-packets.js` / Patch Packet with requirement, preserved behavior, forbidden changes, tests, UNKNOWNs and evidence references; do not create another state owner.
- Before candidate preflight, qualify a BASELINE snapshot and isolated candidate materialization, exact path/type/hash/permission/required-file exclusions and CANDIDATE snapshot.
- Reuse existing Sandbox and PatchService candidate-only. No unapproved writes to the live target repo or production. Add targeted language-specific syntax/type/test checks only where executable in the existing sandbox.
- Bind requirement -> candidate operation -> executed check; create false-pass negative tests for skipped/weakened assertions, scope violations, mock bypass, bad evidence and stale snapshots.
- Reuse bounded automatic re-fix: pass fresh failure evidence only; stop on repeated/no-progress fingerprints. Respect Local Reviewer/External Review/Strict Completion.
- **Exit:** one actual safe **candidate** is built/tested in isolation with exact revision evidence and a clear approval/apply boundary.

### G4 — Actual runtime dogfood and completion

- Follow the already verified server-core → DebugAI MCP → bounded Host/Guarded GitOps route and exact status readback; preserve project-specific private ingress/registered repository & runtime scope.
- Only invoke production reflection/restart/apply when current delegated/explicit authority and exact Host preconditions permit it; no chat-text credential, no bypass, no sales/customer path changes.
- Qualify live source/container identity, 200 + functionality beyond health, failure-driven candidate, gated apply, real test, regression, bounded re-fix, fresh review and Strict Completion. Do not claim successful patch if permission blocks the apply phase; record it as BLOCKED/NEEDS_AUTHORITY with evidence.
- Measure minimal needed tests/fixtures first, then 50-case/60-case fixed regression and holdout on qualified runtime with unambiguous run identity and resource limits.
- **Exit:** Source/CI/Host/Runtime/Candidate/Review matched real evidence; product closed-loop truly works; remaining work explicitly classified.

### G5 — Optional performance and extra tooling, only after G4 proof

- Model sampling tuning, concurrency 1-vs-2, Fast/Deep lanes, token ceilings, Python-specialized skill, Catalog/KB reuse, large archive ZIP work only when a measured deficit and benefit justify them. Do not make G5 a prerequisite for basic practical DebugAI use.
- Maintain the product target: complete authorized debugging, never fake PASS.

## 3. Work order and merge discipline

1. First complete G0 and pick the one shortest real G1/G2 blocker. No speculative backlog expansion.
2. A single Composer mutation Change Unit at a time. GPT-6 may independently perform non-overlapping GitHub read-only evidence audits. If GPT-6 directly writes source, serialize or require explicitly disjoint paths plus fresh HEAD lease to avoid collision.
3. After each Change Unit: focused tests -> canonical `npm run verify` (including toolchain prerequisites) -> exact-head CI -> project/Issue Current checkpoint -> next smallest missing Gate. Never suppress failing checks or change tests merely to make them green; investigate fixture-vs-production differences from direct logs.
4. If current branch moved, fetch and reconcile before Push/PR update. Never force-push, broad pull, merge to main, or overwrite unrelated concurrent Cursor/Codex/GPT commits.
5. Failed Runtime evidence is not overwritten by source CI. Record exact Server HEAD, model runtime availability, private health and actual commands/results.
6. Do not create or launch a second Cursor coordinator or any routine subagent. Composer continues with deterministic tools and DebugAI when available; GPT-6 adjudicates blockers after reading Composer's report. No automatic paid substitute.

## 4. Reporting — canonical Issue, concise and verifiable

Append a bounded checkpoint to [Issue #41](https://github.com/seigo-gace/debug-ai/issues/41) and [development log #42](https://github.com/seigo-gace/debug-ai/issues/42) per existing Project rules, without deleting history. Mirror necessary Project Current fields through the **verified** Project transport, not by assertion.

Report each completed Change Unit as:
```text
GOAL / USER EFFECT:
CHANGE UNIT / OWNER:
START_SHA -> END_SHA:
FILES / WHY:
CURRENT GATE / TEST / CI RUN URL:
LOCAL RUNTIME SHA / SERVER RUNTIME SHA / DIFFERENCE:
DEBUGAI DOGFOOD RUN_ID / RESULT / EVIDENCE:
WHAT IS DONE:
WHAT IS NOT VERIFIED:
RISKS / PROTECTED BOUNDARY:
EXACT NEXT GATE:
```

No lengthy progress essay, no "all done" from a CI green test, no nontechnical decisions sent back to Master. Escalate only real unresolved product/irreversible/public/cost/provider/model/protected gates with effect/risk/reversibility.

## 5. Stop conditions

- Conflicting Current/SHA/branch and unresolved mutation owner.
- Missing required clean isolated workspace or protected-scope authorizations.
- Evidence inconsistency, stale candidate/snapshot, unsafe symlink/archive/traversal, exposed secrets.
- Failed CI/test or incomplete product evidence is **not** a reason to abandon all work; diagnose and re-fix within the same bounded Change Unit, or choose an independent read-only workstream while blocked.

**Start now at G0 and work to the next safely verifiable end-to-end product gate.** Do not ask Master for routine intermediate approval. Keep cost low by using the smallest sufficient context/model/tool for each step.
