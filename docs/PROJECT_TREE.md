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
  server/control/adapter/security/regression tests

orchestrator/
  platform-neutral canonical cores and durable primitives

tests/
  repository-level contracts and integration tests

mcp/
  guarded nine-tool MCP transport and tests

bin/
  CLI and stdio entry points

scripts/
  build, audit and qualification scripts

docs/
  design, Current state, qualification, MCP/handoff and compatibility evidence

legacy/pc-authority/
  preserved historical PC/Windows authority; not current live Server runtime

Dockerfile / compose.yaml
  container image, service residency, security and persistent-volume contract
```

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
- Test deletion, skip relaxation, fake PASS and security-policy relaxation are prohibited fixes.
