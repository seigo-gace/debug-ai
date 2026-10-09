# DebugAI — Codex Unified Product Development Design & Verified Handoff
Status: **CURRENT HANDOFF ADDENDUM / Codex execution entry**  
Date: 2026-10-09 JST  
Owner: `seigo-gace/debug-ai` (DebugAI PRODUCT, **not** server-core / TGserver / PR61 Host/Workspace inventory)  
Master direction: **GPT CHAT stops its product mutations here; delegate future implementation and technical decisions to VS Code Codex, preserving the adopted design or achieving demonstrably better results.**

> This file is an **execution design addendum** to the existing approved DebugAI Unified Improvement Plan, not a new product architecture or evidence of completion. Codex MUST verify GitHub Current and live Source before using any SHA below; the identifiers are the **handoff checkpoint**, not a perpetual HEAD pin.

## 1. Purpose, outcome and ordering (fixed by Master)

Build ONE working DebugAI that accurately investigates real repositories and generates/constructs/verifies reliable code fixes. **Investigation/source-code understanding and code generation are co-dependent and must improve together**: source evidence, requirement/hypothesis handoff, Patch Engineer candidate quality, isolated construction, deterministic verification, review and guarded completion. Do not resume the obsolete interpretation that codegen is categorically deferred; do not prioritize a stand-alone code generator at the expense of factual investigation.

The approved unifying design was assembled from independent AI design critiques, historic investigation **50-case** and codegen **60-case** tests, published research / tested technologies, and model-specific limitations. Codex must examine the actual adopted authority and embedded evidence; never invent or selectively replace its research. **A measured better outcome is encouraged**, provided the core product purpose, actual effect, source provenance, safety gates, test/evidence accuracy, and Master-owned decisions remain intact; record a precise Design Delta and qualifying baseline-vs-candidate evidence before deviating.

Preferred next measurable milestone: **one real defect** on an authorized repository follows Code Scout → Diagnoser → verified `patch-candidate/v1` → isolated candidate construction → mandatory language-appropriate tests with reliable negative/holdout → Reviewer / guarded approval → real retest / Strict Completion, distinguishing automated simulated tests from real model/runtime behavior. Not every milestone requires a merge or deploy; no false-positive COMPLETE.

## 2. Authoritative reading order — do this at every meaningful resume

**Codex runs SERVER_AI, NOT GPT_CHAT.** Begin with:
1. Fresh `G-ACE-inc/server-core` **README.md** and `docs/LOAD_SCOPE.md`, then `operations/github-project-rule-plane.json`. Follow bootstrap/verify rules including current live Rule Plane verification requirements when mandated.
2. [SERVER_AI Minimal Kernel #16](https://github.com/G-ACE-inc/server-core/issues/16) **full current body** (not just issue title/version) and its referenced Control Plane / Project Current. Do **NOT** load GPT CHAT Rule #17 into Codex/server agent context by default; it is for GPT orchestration.
3. GitHub Project **G-ACE Development Platform #1** Current, then owning DebugAI [canonical Current #41](https://github.com/seigo-gace/debug-ai/issues/41) and [chronology #42](https://github.com/seigo-gace/debug-ai/issues/42), plus current Issue/PR/branch/CI actual evidence. Confirm the assigned CU, exact mutation owner, authority scope and current server/Repo/worktree identity before any write.
4. Read **all of** the adopted [Unified Improvement Plan](DEBUGAI_UNIFIED_IMPROVEMENT_PLAN_20261008.md), especially **§13 (adopted second audit; newer rollout order)**, together with:
   - [Investigation/verification master](INVESTIGATION_VERIFICATION_IMPROVEMENT_MASTER.md)
   - [Codegen reliability delta](CODEGEN_RELIABILITY_DESIGN_DELTA.md)
   - [Sandbox and snapshots delta](CODEGEN_SANDBOX_SNAPSHOT_DESIGN_DELTA.md)
   - [5V-RCCA foundation](CODEGEN_5V_RCCA_FOUNDATION.md)
   - [Existing completion handoff](CURSOR_DEBUGAI_COMPLETION_HANDOFF_20261008.md) for useful facts, not for overruling newer Master Current
   - This **Codex handoff addendum**; source and tests on the actually selected commit.
5. Reuse source before authoring an alternative: `server/workflow.js`, `orchestrator/patch-core.js`, `server/control/sandbox-runtime.js`, `sandbox-sidecar.js`, `sandbox-verification.js`, `sandbox-patch-candidate.js`, `read-only-tool-runtime*.js`, Role Tool Loop / Evidence / Review / Completion contracts, and their existing tests as necessary.

**Keep authorities separate.** GitHub Project/Current governs live work, original adopted design governs intended outcome, actual Source/CI tests govern qualified implementation, authorized Host/runtime readback governs deployment. Notion is historical design support where GitHub authority points there. Never treat README prose, issue headings, a workflow name, or older chat output as runtime evidence.

## 3. Frozen exact handoff checkpoint — source states are NOT merge/deploy states

| Owning PR | Handoff HEAD | Status at verified checkpoint | What is actually qualified |
|---|---|---|---|
| [#56](https://github.com/seigo-gace/debug-ai/pull/56) | `ee4ed9d05af7430e2acb64d746946cf3f7621c0d` | OPEN / DRAFT / UNMERGED | Step14 source snapshot integrity, then six exact-head CI success; 549/549 Source + real isolated suite; **not** whole-tree, candidate semantic E2E |
| [#59](https://github.com/seigo-gace/debug-ai/pull/59) | `6f2040bb2e72f191c544a0e8539f823282d72d20` | OPEN / READY / UNMERGED; stacked on #56 | bounded real local import candidates, SHA, coverage, symlink/canonical-secret guard; 552/552 with real isolated suite, 4 applicable CI |
| [#60](https://github.com/seigo-gace/debug-ai/pull/60) | `d4b94b39391505aca34fb2b05661decfc602bc88` | OPEN / READY / UNMERGED; stacked on #59 | Code Scout to Diagnoser Evidence handoff with forged/coverage digest rejection, deterministic role stubs only; 555/555, 4 CI |
| [#63](https://github.com/seigo-gace/debug-ai/pull/63) | `b67c9c7c8e639a831b4b3cf59cb8f4e8a4f2f6e0` | OPEN / READY / UNMERGED; stacked on #60 | source-bound multi-file isolated candidate copy, exact manifest & delta, **real sidecar+Landlock+seccomp changed two-file roundtrip**, 559/559, 4 CI |
| [#64](https://github.com/seigo-gace/debug-ai/pull/64) | `96d1f8d43851fc834798483030be25e1fa1cf8ee` | OPEN / READY / UNMERGED; stacked on #63 | **real existing** `patch-candidate/v1` adapter, integrity+preconditions/EOL/sequential edit checks; 562/562, 4 CI |
| [#65](https://github.com/seigo-gace/debug-ai/pull/65) | `504fce8af8139f0fde546ab4ba494524fb8e9c91` | OPEN / READY / UNMERGED; stacked on #64 | candidate id/hash bound into request + snapshot digest + check Evidence, tamper/ref mismatch rejection; 564/564 Source and real isolated test, 4 CI |

At this handoff all six above were confirmed OPEN and **not merged**. The adopted **product work tree is a stacked PR chain**: #56 → #59 → #60 → #63 → #64 → #65. Preserve the chain's exact content/ownership; do not accidentally merge, flatten, reset, cherry-pick or overwrite upstream/parallel writers. Before extending the chain, fresh-check the actual **PR #65 HEAD** and downstream PR base. If other agents advanced branches, resolve by clean rehydrate, not guess or force-push.

Different owner: [PR #40](https://github.com/seigo-gace/debug-ai/pull/40) remains an independent upstream feature owner; its HEAD had advanced to `c15939bd3401826b8b66dad79d822fa29bb733e0` at checkpoint. [PR #61](https://github.com/seigo-gace/debug-ai/pull/61) became merged as part of **separate Host/Workspace/Project inventory** work. Do not silently adopt that work, modify the Host project tree or repeat another CHAT's consolidation.

**Latest #65 direct workflow evidence** (4 applicable checks, separate from #56 six-workflow requirement):
- [Verify](https://github.com/seigo-gace/debug-ai/actions/runs/37892777647): 564/564 PASS, 0 fail, 0 skipped; real TS7.0.2.
- [Core Verify](https://github.com/seigo-gace/debug-ai/actions/runs/37892777664): 564/564 PASS, real sidecar+Landlock+seccomp and two-file candidate queue roundtrip.
- [Public Readiness](https://github.com/seigo-gace/debug-ai/actions/runs/37892777672): SUCCESS.
- [Runtime Volume](https://github.com/seigo-gace/debug-ai/actions/runs/37892777719): SUCCESS.
Canonical [product checkpoint #41](https://github.com/seigo-gace/debug-ai/issues/41#issuecomment-6075554091) and [chronology #42](https://github.com/seigo-gace/debug-ai/issues/42#issuecomment-6075558987).

**Stop point at handoff**: GPT CHAT completed PR65 source/CI; no new code mutation after this point. This separate docs-only handoff PR is **not** itself evidence of new code qualification. `LIVE_MODEL_PATCH_ENGINEER_E2E=NOT_VERIFIED`; `PREAPPROVAL_LANGUAGE_SPECIFIC_LINT_TYPECHECK_TEST_BUILD=NOT_QUALIFIED`; `REAL_INVESTIGATION_50_DELTA=NOT_MEASURED`; `REAL_CODEGEN_60_DELTA=NOT_MEASURED`; `WHOLE_TREE_COMPLETENESS=NOT_VERIFIED`; `LIVE_PRODUCTION_REFLECTION=NOT_VERIFIED`; `STRICT_COMPLETION=NOT_VERIFIED`. Never equate a real **fixture** sidecar test with real **AI-generated** defect closure.

## 4. Current construction design that Codex must preserve

- **Existing patch authority**: `orchestrator/patch-core.js` owns `patch-candidate/v1` with signed-*by-digest* (not cryptographic external attestation) `candidate_hash`, `diff_hash`, `preconditions`, `operations` and `files`. Read actual code to confirm whether an operation is `replace/write/create/delete`; avoid inventing fields. Original preapproval adapter rejects legacy unrestricted `write` and calls existing canonical `assertCandidateIntegrity`, `revalidatePatchCandidate`, `candidateExpectedState`, `renderExistingText`.
- **Isolation**: `prepareSandboxJob` copies an allowed bounded repository snapshot **before mutation**, stages only bounded `create/replace/delete` in the **job copy**, binds exact source and candidate manifests, selected paths, digest and delta, and checks both before native helper. Real Source repo is untouched. Fail closed on traversal/protected/excluded/symlink, stale sha, duplicate, missing required files, unexpected extra file/mode change and falsified hash.
- **Execution/verification**: reuse existing Sidecar+Landlock+seccomp, allowlisted action, bounded time/bytes/files, exact source/dependency provenance, Evidence/Reviewer/Strict Completion. Candidate cannot be treated as applied or approved. Existing package-test provisioner deliberately **does not** alter a preverified candidate to inject dependencies. Candidate package tests may remain unconfigured until verified dependency artifact strategy exists; never turn a missing check into PASS.
- **Candidate proof**: PR65 stores `patch_candidate_ref` in request/candidate snapshot and deterministic Evidence and rejects mismatches. It is **request-local digest consistency, not externally signed anti-adversarial attestation** against arbitrary request rewrites. If stronger trust needed, use existing receipt/Host authorities and evidence; do not invent signing keys or grow auth surface without approval.
- **Investigation proof**: `source.search` coverage receipt, `dependency.map` candidates and hashes, `source.read` protected canonical realpath, cross-role Evidence readback and tampering negatives are source-qualified. Import candidates are **not** AST-verified call graph or complete project dependency closure; role-stub tests are **not** real Diagnoser accuracy.
- **Research/reuse/5V**: Stage skill/model/KB/Catalog features ONLY when baseline failure and actual transfer benefit warrant them. Do not create duplicate Orchestrator, Tool Loop, reviewer, state engine, patch system or sandbox. The adopted plan's research and benchmark methodology wins over unsupported opinion.

## 5. NEXT EXACT GATE — full Codex-owned technical decision latitude

### Primary missing product gate: a genuine preapproval generated candidate verification slice

G0 — **Fresh Re-anchor + owner gate.** Read Rule #16 and Project #1, #41/#42 Current, adopted plan §13, this document, PR63–65 source, related tests, current upstream vs stacked PR. Verify actual `OWNER_REPO`, branch HEAD, clean state, mutation owner. Preserve current work and no duplicate work. Confirm whether the next gap has already been addressed by concurrent work; if yes, advance directly to its next unqualified gate.

G1 — **Real implementation/evidence audit.** Trace existing `patch-candidate/v1` → `sandbox-patch-candidate.js` → `prepareSandboxJob` → candidate snapshot → `sandbox-sidecar.js` → actual lint/typecheck/test/build capability → evidence/reviewer. Find the **smallest high-impact reproducible deficiency** preventing preapproval verification for one *supported JS/TS project*, including candidate dependency artifact admission, package tests and false-PASS/side-effect protection. Codex may select a demonstrably better technical approach than the illustrative one below, but must preserve stated product intent and safety.

G2 — **One owner, one bounded Change Unit** using fail-first negative(s), positive and independent holdout(s), smallest reuse-first correction. Ordinary deterministic developer tests on the owned Source branch are allowed. **Untrusted generated candidate code** and candidate writes must never run against the owning production repository; run candidate build/test in the guarded **isolated candidate**, with bounded resources, correct language/test runner and true failure propagation. Do not import host Secrets, expand runtime network, disable Landlock/seccomp or let package dependencies mutate an unqualified candidate. If safe dependency admission is not possible, mark that check `NOT_CONFIGURED` and continue other authorized tasks. Compare expected edited scope, preserved behavior and forbidden edits with actual Candidate delta and tests. Keep `PatchCandidate` provenance to diagnostic Evidence/requirements, not merely an unverified model response.

G3 — **Exact SHA proof**: local deterministic tests and existing real TS7/Sidecar gates, all applicable new-head CI, 0 unexpected skips, direct job-log evidence of truly executed modified code (not mock-only), tamper/stale/source-change negatives, final Runtime status only if actually read back and authorized. Record changed Source paths, branch/head, test count/CI URL, safety invariants, leftover gaps, and next gate to #41 and #42; do remote readback.

**Following CUs (evidence-directed, not parallel write owners)**:
1. Actual read-only real-repository Code Scout→Diagnoser→Patch Engineer candidate route with role/model identities, `source.search` bounds and requirement packet/hypothesis/false-claim negatives.
2. One authorized real defect repair vertical slice, including code candidate, deterministic language-specific tests, Reviewer and guarded Master/Host-approved apply if required. **Approval boundaries remain binding**.
3. Matched investigation 50-case and codegen 60-case/source-level holdout rebenchmarks when runtime/model/cost admission is available; compare baseline + total distribution, timeout, role parity, false PASS, queue timings and semantic success. Success-only averages and CI fixture counts are not comparable benchmarks.
4. Only then prioritize cost/performance/reuse/language coverage/5V experiments on direct evidence.

If Codex proves an alternate implementation provides **equal or better impact with less code/latency/cost and no safety/quality regression**, it may choose it without a routine Master question; record precise adoption evidence in a Design Delta instead of silently changing the baseline. Unproven optimization, source-only green CI or tool mocks are not sufficient evidence to change Product promises or completion state.

## 6. Codex autonomy, workspace and approval boundaries

Master delegates **routine technical investigation, branching, implementation, tests, CI repairs, evidence analysis, safe rollback and technical decisions** within DebugAI's adopted scope. Work as far as safely permitted without asking Master to choose implementation details, commands, models or tools. Do not stop at a proposal, documentation or a status summary if a scoped safe task remains executable. Maintain at least one completed, evidenced Change Unit per iteration when possible.

Codex must obey its own live SERVER_AI kernel even where that requires **one Change Unit/Gates 1–3/report/stop** per invocation; a new invocation must fresh rehydrate and take the next CU. Do not silently start unbounded workers or change the number of mutation owners. Master-owned product/spec/user-visible impact, irreversible persistent state, material scope/security/secret/provider/cost or public exposure changes remain protected. GitHub Source, CI, Runtime, Merge and Deploy are separate gates. Existing verified Host delegation is NOT a blanket authorization for new paths/effects. No blind merge/force-push/production deploy.

**Critical server Project-list rule (2026-10-09 Rule #16):**
- Canonical owning server Project parent must be verified from current Host/Registry, historically `/home/admin1/projects/debug-ai`. Do not assert actual realpath/HEAD from documentation alone.
- Allowed: use an existing branch or owned nested worktree **strictly within the canonical parent**, e.g. `/home/admin1/projects/debug-ai/.worktrees/<owned-cu>`, only after resolving both realpaths, common Git directory, and collision/ownership.
- Forbidden: new sibling `/home/admin1/projects/debug-ai-<task>` or any unregistered top-level child/sibling project; a `git worktree` itself is **not categorically forbidden**.
- Do not move/remove another CHAT's unrelated top-level consolidation or PR61/Host assets. `CREATED_NEW_TOP_LEVEL_SIBLING=NO` is an actual readback, not an assumption.

If blocked in one owner-dependent mutation, preserve it and continue independent read-only qualification or safely owned next work as current Rule permits. Never report **complete**, **deployed**, **real semantic improvement**, or **merged** without direct evidence. No paid optional subagents, provider/model swaps or surprise spend.

## 7. Required terminal reporting to GitHub (not just chat)

Each completed CU must report:
```text
PROJECT=DebugAI
PURPOSE=Unified investigation + codegen real product quality
APPLIED_RULE=SERVER_AI #16 (fresh current body verified)
DESIGN=Unified Improvement Plan §13 + this execution design
REPO / CANONICAL_PARENT / GIT_COMMON_DIR / CU_OWNER / WORKTREE_REALPATH=
BRANCH / BEFORE_SHA / AFTER_SHA / PR / BASE_HEAD=
GATE1_DEFECT_EVIDENCE=
GATE2_IMPLEMENTATION_SCOPE / FAIL_FIRST / HOLDOUT=
GATE3_LOCAL_TESTS / EXACT_SHA_CI / ACTUAL_SIDECAR / SEMANTIC_E2E=
SOURCE=PASS|FAIL|BLOCKED
CI=PASS|FAIL|BLOCKED
LIVE_RUNTIME=PASS|FAIL|NOT_VERIFIED
INVESTIGATION_SEMANTIC=MEASURED|NOT_MEASURED
CODEGEN_SEMANTIC=MEASURED|NOT_MEASURED
MERGE=NO|AUTHORIZED_AND_VERIFIED
DEPLOY=NO|AUTHORIZED_AND_VERIFIED
PROTECTED_DECISION=NONE|OWNER_REQUIRED
NEXT_EXACT_GATE=
REMOTE_GITHUB_ISSUE_41_42_READBACK=
```
Use relevant evidence URLs/IDs and do not reproduce sensitive files, credentials or raw secret-bearing logs.

**Starting action for Codex:** Fresh-read all required authority and actual current code; claim one safe **product** Change Unit at the primary missing preapproval candidate verification gate; implement/verify/report, with independent technical decision authority. If blocked, leave a precise checkpoint and continue only scope-safe independent work. This handoff authorizes no automatic production merge/deploy or another Project's work.

## 8. Notion decision context synchronization — additional Master requirement (2026-10-09)

This section supplements the existing rule/authority order, **not** replaces GitHub Current. The latest Master bootstrap correction requires recovery of discussion rationale, rejected alternatives, design comparisons, decisions and missing assumptions that may be lost between CHATS. The historical knowledge source is Notion; verified implementation/CI evidence remains in repository/GitHub and live runtime.

**Fresh-read these relevant Notion decision/background records where the executor has an authorized Notion connector:**
- [2026-10-08 adopted DebugAI integrated-improvement design audit, adoption reasons, rejected interpretations, 2026-10-09 Codex transfer addendum](https://app.notion.com/p/3f3cdcf128e481159b79f425cce96ba9) — page `3f3cdcf1-28e4-8115-9b79-f425cce96ba9` (GPT CHAT directly read, appended missing Master rationale/continuity, then **readback verified** 2026-10-09).
- [2026-10-03 internal assets, cross-AI/industry/tool/paper research](https://app.notion.com/p/3eecdcf128e48127b740da7322543841) — page `3eecdcf1-28e4-8127-b740-da7322543841`; research/discard reasons are **reference and adoption context**, not proof the feature is implemented or that a paper's score applies to DebugAI.
- [Project DebugAI historic authority and old handoffs](https://app.notion.com/p/3e4cdcf128e481fb9c90f39ede1092c2) — page `3e4cdcf1-28e4-81fb-9c90-f39ede1092c2`; prior [2026-10-06 snapshot](https://app.notion.com/p/3f0cdcf128e481aea354f6c7f31bc796) is **superseded for CURRENT HEAD/PR/Host** and must never override fresh Project #1, #41/#42, actual PR and runtime evidence.

**Every meaningful Codex resume:** (1) fresh SERVER_AI #16 + Project Current/owner + adopted Repo design and real Source; (2) access the relevant Notion adoption/decision background if accessible and identify conflicts/unknowns; (3) apply current accepted design and continue one owned safe CU without restarting completed work; (4) after new substantive reasoning, record **only new non-duplicate decision context** (why selected/rejected, evidence, unknown assumptions, design rationale) into the appropriate Notion page if an authorized write tool exists, and always link the corresponding GitHub exact CU/PR/CI/Issue; (5) ensure Notion write readback, or report precisely `NOTION_SYNC=NOT_VERIFIED` / `UNAVAILABLE` and log what remains to synchronize under #41/#42. Do not falsify a Notion write or ask Master to be a routine note-taker.

**Ownership:** Notion = background discussion / alternatives / decision reasons / knowledge gaps; GitHub Project + Issues = current work and ownership; Repo = adopted design and actual Source; CI / authorized Runtime = execution proof. Do **not** elevate Notion to a competing live operational current or silently transform old Notion r12/r18 history into the SERVER_AI Rule Plane. GPT CHAT Rule #17 remains **CHAT-only**, not part of the Codex bootstrap. Notion access absence by itself is not permission to skip protected gates, nor a reason to halt other independent authorized product Source work.
