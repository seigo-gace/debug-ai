# DebugAI Project Tree

`scripts/host-gitops-master-internal.sh` validates the canonical server-core Master
registry inside the existing runner; it is not an executor. The trusted Host
`scripts/host-gitops-register-master.sh` admits/disables/revokes private registry
entries with readback/audit and never deploys. `ops/tests/gitops-master-internal.test.cjs`
covers actual Bash/jq registry/receipt/lifecycle regression; shared real Host fixture
lives in `ops/tests/fixtures/gitops-delegation-fixture.cjs`.
`docs/MASTER_INTERNAL_PERSISTENT_DELEGATION.md` owns this additive design delta,
registration/mapping/lifecycle/compatibility and Runtime qualification contract.

`scripts/host-gitops-delegation.sh` is a sourced policy/receipt helper of the existing
Host GitOps runner, not an executor. `ops/tests/gitops-standing-delegation.test.cjs`
owns real Bash/jq authorization/receipt/replay regression.
`docs/GITOPS_STANDING_DELEGATION.md` records the explicit design delta, Host-only
trust contract, compatibility, revocation and live qualification gates.

`ops/tests/server-command-host-execution.test.cjs` executes the existing bounded
Host runner with real Bash/jq against temporary queues, checking terminal ID
correlation, mirror fallback and approval rejection. Verify CI owns this Host
toolchain gate; the production container does not acquire Host executor dependencies.
The existing oneshot refreshes authorized Docker group access with `sg docker`
and allows 40 minutes for the bounded deploy cycle. No socket permission change or
new service is introduced.

The existing `ops/systemd-user/debugai-server-command.path` watches Server Command
and GitOps request queues; its existing oneshot service runs their respective
bounded Bash runners. GitOps retains its exact-SHA Host approval contract.

This file is a responsibility map for development work. It is not an exhaustive generated file listing and does not replace architecture or current-state authority.

## Authority order

```text
README.md
-> docs/CURRENT_STATE.md
-> docs/PROJECT_TREE.md for responsibility/location lookup
-> architecture / qualification / MCP documents as required
-> task-specific source and tests
```

GitHub source, CI, shared AI Core runtime, live DebugAI Server state, and production state remain separate facts.

## Repository responsibility map

```text
.github/workflows/
  CI, exact-head Development Probe, Core Verify, public-readiness and targeted TGserver logging gates

server/
  production HTTP/runtime workflow, patch/verify services and runtime composition

server/control/
  RunAuthority, evidence/role/tool/skill policies, completion gates, Sandbox/DAP control and qualification logic

server/adapters/
  external/internal service adapters including AI Core, TGserver and Evidence Search boundaries

server/tests/
  server/control/adapter/security/regression tests, including guarded GitOps host-executor policy contract and bounded automatic re-fix regression
  role-contract-correctness.test.cjs covers malformed role fields, diagnosis Evidence binding,
  unsupported confirmation, UNKNOWN, shadow compatibility and held-out false-pass cases
  source-search-coverage.test.cjs covers bounded search negatives, receipt integrity and evidence rehydration
  dependency-map-local-candidates.test.cjs verifies Code Scout real read-only source candidates,
  source hashes, ambiguity, protected/symlink/escape bounds, truncation and directory-index holdouts
  patch-engineer-skill-effect-benchmark.test.cjs includes deterministic oracle false-pass and typed-field holdouts
  runtime-packets.test.cjs covers nested constraint/evidence immutability and input-alias isolation
  requirement-handoff.test.cjs covers actual workflow/candidate requirement binding, forbidden paths,
  stale references, insufficient input and re-fix retention; startup recovery also covers durable origin
  sandbox-snapshot-integrity.test.cjs covers LOCAL_FIXTURE_ONLY manifest/copy integrity,
  required omissions, unsupported links, changed bytes/modes and unconfigured construction

ops/tests/repository-snapshot-real-git.test.cjs
  explicit offline real-Git snapshot regression; separate from Git-command unit fixtures in the canonical Sandbox suite

orchestrator/
  platform-neutral canonical cores and durable primitives

tests/
  repository-level contracts and integration tests

mcp/
  guarded MCP transport and tests

bin/
  CLI and stdio entry points

scripts/
  build, audit and qualification scripts plus the bounded on-demand host GitOps executor

docs/
  design, Current state, qualification, MCP/handoff and compatibility evidence

legacy/pc-authority/
  preserved historical PC/Windows authority; not current live Server runtime

Dockerfile / compose.yaml
  container image, service residency, security and persistent-volume contract
```

## Guarded GitOps execution boundary

`server/control/gitops-request.js` owns the structured publish/deploy request queue inside the DebugAI source contract.

`scripts/host-gitops-runner.sh` is the bounded **on-demand** host executor for those requests. It uses the existing host `git`/`docker` command path only when explicitly invoked; it is not a resident Host Node/Python process and no DebugAI-specific systemd watcher/service is installed by this source.

Publish remains exact-current-HEAD, candidate-identity, file-scope and remote-readback gated. Deploy may start from a clean older server checkout, but only after exact remote/fetch target verification, a fast-forward ancestry check, and consumption of the exact request/SHA host approval file. This source contract does not itself authorize Production deployment.

## Current Sandbox verification path

```text
Core Verify
  -> build DebugAI image
  -> build existing sandbox-runner sidecar image
  -> Landlock + seccomp isolation gate
  -> DAP loopback-only gates
  -> existing managed Sandbox queue
  -> exact-source DebugAI package.test snapshot
  -> provenance-bound native/dependency provisioning
  -> exact-source-bound trusted SIGKILL supervisor only for crash-test descendants
  -> npm test inside sidecar+landlock+seccomp
  -> numeric Node test summary gate
  -> require tests>0 / pass=tests / fail=0 / skipped=0
```

At qualification head `71bc123112e07859dce5b7ae24afaff7eec86a4f` for implementation `d1ee3ffd175fc530afe8f38e782859d1d63c8e61`, Core Verify run `37403103007` produced `TESTS=464 / PASS=464 / FAIL=0 / SKIPPED=0` with `BACKEND=sidecar+landlock+seccomp`, `SIGNAL=EXACT_SOURCE_BOUND_CHILD_ONLY`, `SANDBOX_DOCKER_SOCKET=ABSENT`, real isolation PASS, strict socket deny PASS and DAP loopback-only PASS.

## Automatic re-fix execution boundary

`server/workflow.js` owns the bounded failed-retest recovery path. It reuses the existing canonical state machine rather than introducing a second orchestrator.

`server/tests/workflow-automatic-refix.test.cjs` locks four contracts: fresh failed retest can produce a new candidate but must return to explicit approval; fresh external hypothesis non-PASS escalates; retry-budget exhaustion escalates; and an explicitly approved replacement candidate can pass retest and reach Strict Completion `COMPLETE` in the same run.

Automatic re-fix is candidate-generation only. It does not own approval, apply, publish, deploy or shared Server-executor responsibilities.

## Mutation boundaries

- Source/document/CI work on the existing feature branch does not authorize live Server reflection.
- Merge, Deploy/recreate/restart, Secret/provider/model/profile changes and persistent-state deletion remain separate approval boundaries.
- Never create a second orchestrator, Sandbox service or runtime merely to make verification pass.
- Do not install Host Node/Python or a DebugAI-specific resident host service merely to execute Guarded GitOps.
- Test deletion, skip relaxation, fake PASS and security-policy relaxation are prohibited fixes.

## Bounded control surface extension — 2026-10-07

`server/http.js` exposes Server Command request/status through the existing `server/control/server-command-request.js` service. `server/main.js` passes its existing instance; no second service is constructed. `bin/debugai.js` forwards structured control JSON to HTTP, and `mcp/server.mjs` delegates the four appended control tools to that CLI. Existing GitOps routes, service, Host runners, systemd units and queues are reused unchanged. Regression coverage remains in the existing MCP, Server Command and GitOps test files; the pre-server audit requires the exact thirteen-tool surface and forbids approve/apply tools.

## Candidate preapproval verification

`server/control/sandbox-verification.js` owns baseline collection and candidate-aware
lint/typecheck/test/build collection through the canonical adapter. `server/workflow.js`
invokes and persists this evidence before initial/refix candidates wait for approval.
`server/tests/sandbox-candidate-verification.test.cjs` covers identity/source/false-PASS
negatives and actual Workflow ownership. The existing `sandbox-queue-selftest.js`
`verify-candidates` mode qualifies real Sidecar candidate syntax/runtime failure and
independent boundary holdouts in Core Verify. Design/limitations belong to
`CODEGEN_SANDBOX_SNAPSHOT_DESIGN_DELTA.md` §15.

- `server/adapters/external-review-quota.js` — Host-owned FREE evidence validation and atomic rolling quota reservations for the existing external reviewer.
- `scripts/external-review-volume-probe.cjs` — offline container-recreation persistence probe used by the existing Runtime Volume CI.
