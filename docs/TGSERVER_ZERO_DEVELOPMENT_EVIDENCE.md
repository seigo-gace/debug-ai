# TGserver ZERO / GitHub Development Evidence

## Purpose

This document defines the canonical evidence-retrieval path used by CHAT-side development for DebugAI.

The goal is to let CHAT retrieve Source/Test/Build/Verify evidence from GitHub Actions and Runtime/Server Log evidence from TGserver ZERO without requiring Master to copy ordinary logs or test output from a Server terminal.

This integration does not create a second verification framework, a Project-local TGserver Reader, or a Server command channel.

## Authorities

TGserver ZERO integration authority:

- repository: `seigo-gace/TGserver`
- ZERO main integration baseline: `9282f3540f9bf47cfad7e7814da8fd7145d44bba`
- `README_ZERO.md`
- `docs/TGSERVER_ZERO_PROJECT_INTEGRATION.md`
- `docs/templates/dev-probe.yml`

DebugAI project authority remains this repository's README / current-state / design / tests. Current `G-ACE-inc/server-core` controls shared development, GitHub, Runtime, Secret, and approval boundaries.

TGserver vNext is not used by this integration.

## 1. Source / Test / Build / Verify evidence

CHAT requests repository-side evidence through the owner-only Development Probe:

```text
.github/workflows/dev-probe.yml
```

The workflow reuses the existing DebugAI canonical verification path. It does not define a new test framework.

Canonical setup and verify contract:

```text
Node.js = 24.20.0
npm install --ignore-scripts --no-audit --no-fund
DEBUG_AI_REQUIRE_TS7_REAL=1 npm run verify
```

`npm run verify` already owns the DebugAI repository verification chain:

```text
build:durable-native
-> check
-> test
-> audit:pre-server-qualification
```

The Development Probe captures the canonical verify output in a bounded GitHub Artifact and keeps the full GitHub Actions Job Log readable by CHAT.

### Issue contract

Normal execution request:

```text
Title: [DEV-PROBE] verify current source
Body: Verify current source and return GitHub Actions evidence.
```

The Issue body is data-only request context. The workflow never evaluates it as shell, a script path, URL, Secret, deploy target, or Server command.

Only an Issue opened/reopened by the repository owner with a title beginning `[DEV-PROBE]` is admitted.

A pull-request-only self-test lane is also present so the workflow implementation itself can be verified before an approved default-branch merge. It runs the same fixed canonical verify command and has no Server/Runtime mutation capability.

## 2. Artifact contract

Every admitted probe writes only bounded evidence files under:

```text
dev-probe-evidence/
```

The Artifact includes:

- `verify.log` — canonical verify stdout/stderr captured with `pipefail`;
- `metadata.txt` — repository, exact GitHub SHA, event, workflow run ID, and fixed canonical verify identifier.

Artifact name:

```text
dev-probe-<github.run_id>
```

Retention: 3 days.

Artifact generation does not turn a failed verify into PASS. Job conclusion remains authoritative for the Development Probe result.

## 3. Runtime / Server Log evidence

DebugAI does not copy TGserver ZERO Cloudflare Access Secrets into this repository and does not call the external ZERO Reader directly from this repository.

CHAT uses the central Reader in:

```text
seigo-gace/TGserver
```

TGserver ZERO source registry mapping:

```text
repo=seigo-gace/debug-ai
stream=runtime -> P004
stream=kb      -> P005
```

Because one repository owns two streams, `stream` is mandatory. Project IDs are not supplied by CHAT or inferred from Issue text; the central Reader resolves them from the TGserver ZERO repository map.

Typical Runtime Log request to the central Reader:

```json
{
  "kind": "tgserver-zero-search",
  "repo": "seigo-gace/debug-ai",
  "stream": "runtime",
  "query": "",
  "severity": null,
  "from": null,
  "to": null,
  "purpose": "DebugAI runtime evidence for current development"
}
```

The resulting route is:

```text
[TGZERO] GitHub Issue
-> TGserver ZERO central GitHub Actions Reader
-> Cloudflare Access held only by TGserver repository
-> legacy GET /health + POST /search
-> sanitizer
-> GitHub Artifact
-> CHAT reads Job Log / Artifact
```

Runtime search evidence is a separate state from DebugAI Source/Test/CI evidence. A successful search does not prove that the current DebugAI source SHA is deployed.


## 4. Dogfood learning/evaluation corpus

The Runtime/Server evidence path is also the primary chronological source for staged DebugAI dogfood episodes.

This is deliberate: real commands, real Server results, real diagnoses, failed fixes, accepted fixes, retests, regressions, invariants, reviewer outcomes, and parent-orchestrator interventions are high-value evidence for improving DebugAI.

Storage contract:

```text
P004 = sanitized chronological runtime/dogfood events
RuntimeEvidenceStore = exact bounded per-run evidence
P005 = only confirmed reusable lessons/knowledge
```

P004 should preserve enough structure to reconstruct an episode without exposing secrets or private chain-of-thought. At minimum, events should carry stable run identity plus event kind/state and the bounded identifiers needed to relate instruction, evidence, candidate, action, verification and outcome.

Raw failures are valuable and must not be discarded merely because the final run later succeeds. A failed fix followed by the successful fix is a stronger learning record than the final successful diff alone.

Do not automatically call this model training. The collected corpus is first used for evaluation, prompt/routing/policy improvement, regression fixtures, benchmark cases, skill selection and instruction-quality measurement. Any future fine-tuning/training is a separate approved process.

The canonical staged progression and full record model are defined in [`STAGED_DOGFOOD_LEARNING_PLAN.md`](STAGED_DOGFOOD_LEARNING_PLAN.md).

## 4. Security / mutation boundary

The Development Probe and TGserver ZERO central Reader must never provide:

- arbitrary shell execution from Issue content;
- arbitrary Server command execution;
- SSH command relay;
- Docker restart/recreate/deploy controls;
- Secret changes or Secret value output;
- Provider resource mutation;
- production deployment or traffic switching;
- TGserver vNext access.

Main merge, Production Deploy, Runtime reflection, restart/recreate, Secret changes, and Provider changes remain separate `server-core` / DebugAI approval boundaries.

## 5. CHAT operating sequence

For future DebugAI development:

```text
Need Source/Test/Build/Verify evidence
-> use DebugAI [DEV-PROBE]
-> read Actions Job Log
-> read dev-probe Artifact when needed

Need Runtime/Server Log
-> use seigo-gace/TGserver [TGZERO]
-> set repo=seigo-gace/debug-ai
-> explicitly set stream=runtime or stream=kb
-> read ZERO Reader Job Log / sanitized Artifact

Need Server mutation
-> do not use either bridge
-> follow current server-core and DebugAI approval boundary
```

Master Terminal evidence is reserved for facts that these bounded GitHub/TGserver paths cannot retrieve.

## 6. Completion semantics

Keep these states separate:

```text
DEV_PROBE_SOURCE
DEV_PROBE_CI
CHAT_ACTIONS_LOG_READBACK
CHAT_ARTIFACT_READBACK
TGZERO_PROJECT_REGISTERED
TGZERO_PRODUCER
TGZERO_SEARCH
CURRENT_SOURCE_DEPLOYED
RUNTIME_CURRENT_SHA
```

No state is promoted from another signal. In particular, GitHub CI PASS and TGserver ZERO search PASS do not prove current-source Runtime parity.

## 7. Adopted on-demand Actions Artifact to ZERO Evidence (2026-10-10)

Master adopts safe GitHub Actions artifact ingestion. Normative contract and acceptance are Unified Improvement Plan section 15. Reuse existing GitHub read, DebugAI Evidence Registry/RuntimeEvidenceStore and TGserver ZERO producer. Never create a second TGserver reader, new persistent daemon, queue product, MCP, workflow or token.

Sequence: authorized repo/run/artifact metadata -> immutable artifact download under size/time limits -> isolated, nonexecuting, adversarial ZIP admission -> redacted bounded test/log excerpts -> registered evidence IDs with run/attempt/head-SHA/artifact-ID/path/digest provenance -> bounded Diagnoser -> existing TGserver ZERO producer/search correlation.

Source artifact generation, GitHub log readback, artifact intake, Evidence registration, ZERO search and production runtime SHA are separate gates. CI PASS and Artifact download do not establish DebugAI model accuracy, host reflection, or Strict Completion. Optional future Webhook/Actions trigger may reuse existing admitted event path only after on-demand E2E qualification.

Current status: DESIGN_ADOPTED; safe ZIP ingestion and actual Artifact -> Evidence -> ZERO E2E NOT_VERIFIED. No new Groq/Gemini requests or billing changes.

### 7.1 Actual on-demand Artifact slice — 2026-10-10

Current isolated implementation: `scripts/actions-artifact-evidence.cjs <request.json>`. Request fields: `repository`, numeric `runId`, numeric `artifactId`, exact `headSha`, numeric `attempt` (currently 1), `evidenceRunId`. Reuse the existing Host gh authentication and admitted private registry; require existing `DEBUG_AI_RUNTIME_ROOT` and TGserver producer URL/project IDs. Script rotates the same RuntimeEvidenceStore class with configured retention/byte settings and prints sanitized records/localEvidence plus actual ZERO flush/send counters. It never launches a model or patch. Feed retained IDs through `loadArtifactEvidence` into existing `localEvidence` for `/v1/analyze` or `/v1/runs/start`; caller remains responsible for approved diagnosis scope. The intake script itself is a CLI entry, not a new remotely exposed Host command.

Actual failed [Development Probe Run38045681675](https://github.com/seigo-gace/debug-ai/actions/runs/38045681675), source `3b8e5d927eebfd4540e10b64b7ae8aa59284a784`, attempt1, Job114194616355, Artifact11667623484, `dev-probe-38045681675`, ZIP24619 bytes / SHA256 `18fd9202b7e576f518428f7832ad24b2d115eba5713f6fcd548518507ec73076`: authenticated retrieval and digest match, restricted ZIP acceptance, redacted `metadata.txt` and `verify.log`, RuntimeEvidence registration PASS. Actual EVI IDs `EVI_92f868ca279e23ae550ab08d` and `EVI_9992b773344e45a2a9db4ae6`. These records are in the owned isolated runtime-evidence test root, not falsely described as the production volume. Existing Diagnoser Tool Loop consumed these actual registered records using a deterministic local callback, no external provider calls or real-model diagnosis.

Existing producer: enqueued1/sent1/failed0/dropped0; existing `/search` P004 returned exactly correlated indexed hit `bc22d0e8ab3d7eca`, `ingested_at=2026-10-10T11:18:53.197Z`, matching Run/Artifact/SHA/two EVI IDs. Search reports `audit_failure=true`; indexed correlation is proven, durable Telegram/archive completion is NOT_VERIFIED. No second reader or changes to TGserver. Evidence unavailable/expired remains UNKNOWN and cannot prove a failed check. This slice is not production Host reflection or complete DebugAI Strict Completion.

Final implementation `82f12b9960340c66f8880cf61f7d2b2d4face94a` repeated the real slice after adding post-download Run/Artifact fresh-read and trusted-registry directory checks: actual EVI `EVI_cfb967760d05c1b5ff85ab44` / `EVI_c53d004696aecf3826845e24`, received `2026-10-10T11:24:20.557Z`; ZERO1/1/0/0 and matching indexed record `3ff773966ee5acfe` at `2026-10-10T11:24:22.458Z`, audit_failure still true. Retained IDs reloaded/hash-checked and passed to the existing Diagnoser Tool Loop with provider HTTP0. Production remains old Current906470b and does not contain the module.

Existing Host `master_verify_mapping` read-only check PASS; actual `validate_master_internal` on the Artifact branch/82f12b request returned `MASTER_BRANCH_FORBIDDEN` without issuing a receipt or deployment. Installed policy digest `6b183021d08175033835e0cef769a673e8b4a4d621e63de4d6b1c5067c966326`; missing exact paths: `scripts/actions-artifact-evidence.cjs`, `server/control/actions-artifact-evidence.js`, `server/control/actions-artifact-github.js`, `server/control/actions-artifact-zip.js`. GPT CHAT/authorized existing Host policy owner must reconcile only this branch/four paths, then use the normal Actions→DebugAI guarded reflection; no new credential, issuer, scope, service or broad grants. PR42/Host/Scout files are untouched.

PR95 preliminary exact82f12b CI: normal Verify and Development Probe pass, Runtime Volume/legacy/dependency pass; Core ongoing at checkpoint. Public Readiness rejects the **synthetic private-key header test literal**, not an actual key. Test source is corrected by assembling that synthetic header at runtime; historical offending blob `04f61fd8da09` still requires owned-branch history reconciliation under the explicit force-push boundary. Do not call CI fully PASS or production reflected while these gates remain.

### 7.2 Qualified Source and remaining production boundary — 2026-10-10

Master explicitly approved PR95-only history cleanup. Actually applied exact force-with-lease from1da87d to clean reviewed Source `eb44e26e794e4996ee1019766eb4fbad44a1ed32` with identical files, parent906470b. GitHub remote readback matches all9 changed blobs. [Verify38048602082](https://github.com/seigo-gace/debug-ai/actions/runs/38048602082), [Core38048602225](https://github.com/seigo-gace/debug-ai/actions/runs/38048602225), [Development Probe38048602092](https://github.com/seigo-gace/debug-ai/actions/runs/38048602092), [Runtime Volume38048602216](https://github.com/seigo-gace/debug-ai/actions/runs/38048602216), [Public Readiness38048602171](https://github.com/seigo-gace/debug-ai/actions/runs/38048602171) all SUCCESS (all7 PR checks). Normal and real isolated sidecar776/776, fail/skip0; focused53/53. The historical synthetic-header CI blocker is resolved and remains recorded above. Four implementation/CLI files are byte-identical to the actual82f12b Artifact slice. This later documentation checkpoint requires its own exact-head CI; current PR/Issue work reports own that result.

Acceptance boundary: permitted actual GitHub acquisition, malicious ZIP negatives, masked registered Evidence and SHA/Run/Artifact binding, retained-ID existing local diagnostic handoff, ZERO indexed correlation PASS in the real isolated on-demand slice. Actual provider HTTP0. Authoritative production Evidence volume admission and production runtime/source parity are NOT_VERIFIED. CLI/module is implemented; automatic remote Host/API invocation is not added or advertised. Existing parent `localEvidence` input is the bounded integration seam; any required production-specific invocation must use an admitted existing Host path. Host policy still refuses the Artifact branch and four new paths. Codex sent the minimal actual handoff to [Host PR42](https://github.com/G-ACE-inc/server-core/pull/42#issuecomment-6097021688); only the existing verified policy writer may reconcile it. Do not widen scopes or reuse an allowed other-owner branch to evade denial.

Canonical Host checkout906470b, running image `sha256:01ba2614023eba26bd3b98c0555acbc5f9957ffd9b99cec8b52567330fced259`, healthy/HTTP200, actual Artifact module absent. These prove old Runtime availability, not new Artifact reflection. Index hit `audit_failure=true` preserves an independent durable-archive UNKNOWN. No merge, deployment, public change, protected credential/ledger change or new worker occurred. Exact next gate: properly admitted normal Actions→DebugAI Compose reflection followed by Source/production store/real Artifact/local diagnostic input/ZERO readback. Whole Artifact completion, and broader DebugAI Strict Completion, are NOT_CLAIMED.

### 7.3 Qualified production Artifact slice and concurrent Host boundary — 2026-10-11

PR97 exact `d39ed3e056c7a826563b4d7eb7cd1961a12268fc`, all7 CI SUCCESS, normal and real isolated sidecar785/785 PASS, reflected by existing Actions [38065649456](https://github.com/seigo-gace/debug-ai/actions/runs/38065649456), operation `gitops_985a2b183d9eb9279ccc44c6`: PASS/HTTP200/running|healthy, post-Host HEAD exact. All300 packaged tracked files match the qualified Source in app and sidecar (read-only file-owner byte checks; executable141 separately readable/matching as runtime uid1000).

Actual failed Run38065013296 / Artifact11674346764 / attempt1 / head91974486a9ff1802f2f2ac7a01b044793209fd71, ZIP26214 bytes, SHA256c33124dbd894d3593b8bcbc802c39e67401c1456bd49916e8cd15a51e95ca1eb: authenticated GitHub metadata, fresh download binding and safe parsing succeed. The Host authenticated reader is reused, with only sanitized data passed via finite stdin to the already running container's RuntimeEvidenceStore; no GitHub credentials enter the container. Production Evidence run `artifact_live_38065013296`, IDs `EVI_af29c6f4509bae5d015d1f59` / `EVI_52134b6c3d5b940b79113c87` are loaded from actual retained records, recanonicalized identically and consumed by the packaged existing Diagnoser Tool Loop, FINAL/confirmed_root_cause=null. Diagnostic callback is deterministic/local, zero model/provider calls; this proves the input contract, not model-semantic diagnosis. No source/fixture/Host executable extraction or production directory mutation. Retention uses the existing Store; no manual deletion.

Existing ZERO producer sent2/failed0/dropped0. Exact P004 records: Artifact `ffeae585d890e295` (audit_failure=true) and diagnostic handoff `b473e9c78f83a5aa` (audit_failure=false), ingested2026-10-10T15:59:35.002Z, Telegram31892 batch correlation. Match event run, GitHub Run/Artifact/head SHA and exact EVI IDs, not the search's other unrelated hits. Index delivery is verified; the Artifact record's durable audit remains incomplete and must not be promoted to full durable archive PASS.

Concurrent Owner subsequently reflected PR92/Tool B Source11244d4 and removed Artifact modules from the live image at2026-10-10T16:07:40Z. Above is a qualified historical runtime slice; current Artifact availability is NOT_VERIFIED until the latest Owner-preserving integration is reflected again. Codex integrates exact latest Owner Source in the same PR97; no overwrite of the other Owner's dirty checkout or new runtime service. The existing Host registry is pinned to an exact CI-qualified immutable Source snapshot through supported DEBUG_AI_MASTER_REGISTRY, avoiding live admission changes during edits. Preserve other repositories' current entries and install any next qualified snapshot only via existing trusted admission/readback.

Old dogfood `run_mv24304l_700ed16315` is terminal BLOCKED after bounded retries; existing resume rejects RUN_NOT_RECOVERABLE:BLOCKED as designed, with no unsafe terminal-state mutation. One corrected-source same-input same-fixture replacement `run_mv2l3pxc_bc2e23acf3` was started after verifying the original inactive/terminal, not duplicated while active. It survived the concurrent Owner recreate via existing Startup Recovery; its actual diagnosis/candidate/final outcomes remain separate and pending.
