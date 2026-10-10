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
