# DebugAI Current Source Qualification

This record is the source/CI qualification checkpoint for the current feature branch. It does not replace live Server readback and does not authorize deployment.

## Current source

```text
repository = seigo-gace/debug-ai
branch     = feat/tgserver-async-log-sink-20261003
PR         = #40 OPEN / DRAFT / UNMERGED
implementation SHA                                      = d1ee3ffd175fc530afe8f38e782859d1d63c8e61
source qualification head                               = 71bc123112e07859dce5b7ae24afaff7eec86a4f
live Server SHA                                      = 3997812067fe2a76e7fb6aea246ea8b34aa564c0
qualified implementation deployed                   = NO
```

## Automatic re-fix closure

The previous source returned `FAILED_RETEST` immediately when an approved patch was applied but deterministic retest failed.

At `d1ee3ffd...`, the same run now uses the existing canonical state cycle:

```text
RETESTING
 -> FAILED
 -> RESOLVING
 -> fresh failed-retest evidence
 -> Diagnoser
 -> fresh External Hypothesis Review
 -> Patch Engineer candidate only
 -> PATCH_READY
 -> WAITING_APPROVAL
```

Safety properties:

- maximum two automatic re-fix candidate-generation attempts;
- fresh retest checks/invariants/gates are registered as local runtime evidence;
- fresh external hypothesis review must PASS;
- candidate operations are limited to replace/write inside the prior selected-file scope;
- create/delete and scope drift are rejected;
- no automatic approval or apply exists;
- every candidate returns to explicit controlling-parent/orchestrator approval;
- evidence/scope/review/budget failures transition to `ESCALATION_REQUIRED`;
- latest fresh re-fix analysis is stored as current analysis evidence for later Strict Completion evaluation.

## Canonical source evidence

Development Probe run `37403103008` checked out exact qualification head `71bc123112e07859dce5b7ae24afaff7eec86a4f`, whose only change after the implementation/docs head is the closed-loop automatic re-fix regression.

Observed canonical result:

```text
tests=464
pass=464
fail=0
skipped=0
source_ready=true
server_mutation_authorized=false
```

Dedicated automatic re-fix tests:

```text
failed retest -> new bounded candidate -> WAITING_APPROVAL         = PASS
fresh external hypothesis non-PASS -> ESCALATION_REQUIRED                 = PASS
attempt budget exhausted -> ESCALATION_REQUIRED                           = PASS
explicitly approved replacement -> retest PASS -> Strict Completion COMPLETE = PASS
```

Exact implementation-head workflows all completed SUCCESS:

- Verify `37403103045`
- Core Verify `37403103007`
- Public Readiness `37403102991`
- Runtime Volume Gate `37403103015`
- Development Probe `37403103008`
- Targeted TGserver Logging `37403103011`

## Real isolated Sandbox evidence

Core Verify `37403103007` produced:

```text
SANDBOX_SOURCE_REPO_HASH=UNCHANGED
SANDBOX_DOCKER_SOCKET=ABSENT
SANDBOX_REAL_ISOLATION=PASS
SANDBOX_STRICT_SOCKET_DENY=PASS
SANDBOX_DAP_LOOPBACK_ONLY=PASS
SANDBOX_FULL_SUITE_PASS
BACKEND=sidecar+landlock+seccomp
SIGNAL=EXACT_SOURCE_BOUND_CHILD_ONLY
TESTS=464
PASS=464
FAIL=0
SKIPPED=0
```

No test deletion, skipped-test acceptance, Sandbox/security relaxation, second runtime, Host Node installation, or DebugAI Docker-socket exposure was used.

## Live/source separation

The live DebugAI Server remains exact `3997812067fe2a76e7fb6aea246ea8b34aa564c0`, previously verified running/healthy with `guarded_gitops=true`, request/status endpoints live, host/container source parity PASS and DebugAI Docker socket absent.

The automatic re-fix implementation `d1ee3ffd...` is newer and is not live. Documentation commits after it also do not become live merely by passing CI.

## Remaining boundary

Before any real automatic re-fix dogfood on Production:

1. Current documentation/PR/Issue must be synchronized and final documentation HEAD must pass exact-head CI.
2. Master must explicitly approve one exact reflection SHA.
3. Current server-core deployment authority must be applied.
4. Existing `.env`, `.debugai-input`, persistent volumes, checkpoints, unmanaged and auxiliary state must be preserved.
5. After reflection, exact parity, health, Docker-socket absence, and automatic re-fix runtime behavior must be verified.
6. A real failed-retest flow must prove that automatic work stops at a new candidate and waits for explicit controlling-orchestrator approval before mutation; Master is involved only when the subsequent operation is separately Master-gated.

No main merge, Production deploy/recreate, Secret/provider/model/profile mutation, Search Gate activation, or destructive state change is authorized by this record.

## Control transport source qualification — 2026-10-07

The control extension preserves the original nine MCP tools and adds four, with two Server Command HTTP routes and thin CLI delegation to existing Server Command/GitOps services. Mapping/ownership/rollback boundaries are documented in `MCP_ADAPTER.md` and the appended design history. Related fixture tests passed 28/28; canonical verification in an isolated Node 24.20.0 toolchain passed 480/480 tests with zero failures/skips and source audit `source_ready=true`. Final exact-head CI evidence belongs to PR #40 / Issue #41 and must be read back for the implementing SHA. The initial Host verify attempt stopped because no C compiler was installed; the isolated verification used the real source-bound native build without weakening its provenance checks. This extension has no live-runtime qualification: reflection, merge, deploy and Secret/Provider/Model mutation are NOT_RUN.
