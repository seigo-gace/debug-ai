# DebugAI Current Source Qualification

## Standing Delegation source boundary

The existing guarded GitOps lane now supports Host-only standing delegation for
`deploy` / `debugai.compose.reflect`. Issuer, validity/revocation, exact target,
changed-path scope and request identity are checked before a bound single-use
receipt is issued and consumed. Manual receipt compatibility is retained.
Source/CI qualification and live delegated E2E remain separate gates. The last
fresh live readback before this Change Unit was `4190f870...`; broader PR #40
qualification is unchanged. Contract/design delta: [Standing Delegation](GITOPS_STANDING_DELEGATION.md).

## Host Server Command validation correction

Fresh live reproduction found an extra closing parenthesis in the Host runner's
jq request predicate. The watcher delivered the request, but validation failed
before reading its ID, leaving terminal failure under an `invalid_*` filename.
The correction removes that parenthesis and retains the validated filename ID
before schema validation. Existing queue, readback mirrors, allowlists and approval
checks remain in place. Real Bash/jq lifecycle regression covers valid git-head
readback, unsupported command, wrong repository, expiry, unapproved write and
protected write without Master approval. Local verification is isolated in a
Node 24.20.0/jq container; CI runs the same regression on its Host test toolchain.
Live reflection of this correction is NOT_EXECUTED until exact-SHA approval.

Fresh user-unit readback also found that the existing path unit watches only
Server Commands, while GitOps requests remain queued without any automatic Host
dispatch. The same existing path/service is adapted to watch both queues and run
both existing bounded Bash runners sequentially. No new service, timer, poller,
queue or executor is introduced. Real GitOps regression proves missing exact-SHA
Host approval is rejected before checkout or Docker mutation. Activating updated
units and rebuilding/recreating Production remain separately approval-gated.

Approved reflection to `1c6da080d340ab6a47d447c78a21c8738f2e748a` exposed a
separate readiness race: HTTP health passed while Docker health was `starting`,
so GitOps recorded FAIL although the recreated container later became healthy.
That failed receipt is preserved. The correction waits inside the existing
120-second budget for both HTTP success and `running|healthy`, retaining final
state validation and the existing exact-SHA approval gate. A real Bash/jq Host
regression reproduces HTTP-ready/starting -> healthy and consumes the single-use
approval receipt. This additional source correction is not deployed implicitly.

Live automatic GitOps approval-rejection request `gitops_3e6784dc54cb8e127ee17f09`
also exposed a status polling gap: moving requests to `processing/` temporarily
returned GITOPS_REQUEST_NOT_FOUND. The same status service now reports RUNNING
from that existing lifecycle directory, with terminal status taking precedence.
The Host ultimately rejected the missing receipt with DEPLOY_HOST_APPROVAL_REQUIRED;
no deploy occurred. The regression preserves that boundary and request identity.

Production watcher-driven deploy attempts `gitops_540d3d3f8c4e20002a3418d5` and
`gitops_e98b71157ad85156684a2a57` failed at build. The same Docker builds passed
in the login shell. An existing-unit diagnostic confirmed Docker socket permission
denied: the long-running user manager lacked the docker supplementary group,
although admin1 is already a member. The existing service now uses `sg docker`
for both existing bounded runners to refresh that authorized group at execution.
No socket permissions, group membership, queue, executor or service are added.
The service timeout is 40 minutes to cover the runner's bounded 30-minute build,
fetch, recreate and health budgets; the previous default 90 seconds was insufficient.
The original failed receipts remain unchanged. Source/unit regression is separate
from the required successful production deploy receipt.

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
