# DebugAI Project Tree

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
  server/control/adapter/security/regression tests, including guarded GitOps host-executor policy contract

orchestrator/
  platform-neutral canonical cores and durable primitives

tests/
  repository-level contracts and integration tests

mcp/
  guarded nine-tool MCP transport and tests

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

`server/control/gitops-request.js` owns the structured `publish`, `deploy`, and fixed-scope `project_update` request queue inside the DebugAI source contract.

`scripts/host-gitops-runner.sh` is the bounded host executor. Publish/deploy preserve the existing exact-head, candidate, approval, fast-forward and Runtime gates. `project_update` is separately restricted to GitHub Project #1 owned by `seigo-gace`, Issue/PR content under `seigo-gace` or `G-ACE-inc`, and the allowlisted fields `Status`, `Gate`, `Change Unit`, and `Mutation Owner`. It performs post-write Project readback before PASS.

`scripts/github-project-control-poller.sh` is the CHAT/GitHub control ingress. It accepts only owner-authored open Issues with the exact title `[GACE-PROJECT]` and schema `gace.project-control/v1`, converts them to a bounded `project_update` request, invokes the same host runner, posts the sanitized result back to the control Issue, and closes that request.

`ops/systemd/debugai-project-control.service` + `.timer` schedule that ingress as a short-lived Bash oneshot. They do not add Host Node/Python, arbitrary shell execution, or a Docker socket mount into DebugAI.

This source contract does not itself authorize Production deploy/recreate. GitHub Project maintenance is a separate fixed control-plane mutation from Runtime deployment.

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

At source `b9203e587781daa9c1869dffa6317764642e2742`, Core Verify run `37299751516` produced `TESTS=454 / PASS=454 / FAIL=0 / SKIPPED=0` with `BACKEND=sidecar+landlock+seccomp` and `SIGNAL=EXACT_SOURCE_BOUND_CHILD_ONLY`.

## Mutation boundaries

- Source/document/CI work on the existing feature branch does not authorize live Server reflection.
- Merge, Deploy/recreate/restart, Secret/provider/model/profile changes and persistent-state deletion remain separate approval boundaries.
- Never create a second orchestrator, Sandbox service or runtime merely to make verification pass.
- Do not install Host Node/Python or a DebugAI-specific resident host service merely to execute Guarded GitOps.
- Test deletion, skip relaxation, fake PASS and security-policy relaxation are prohibited fixes.
