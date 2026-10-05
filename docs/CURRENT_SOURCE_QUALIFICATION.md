# DebugAI Current Source Qualification

This record is the source/CI qualification checkpoint for the current feature branch. It does not replace live Server readback and does not authorize deployment.

## Current source

```text
repository = seigo-gace/debug-ai
branch     = feat/tgserver-async-log-sink-20261003
PR         = #40 OPEN / DRAFT / UNMERGED
qualified source SHA before documentation sync = b9203e587781daa9c1869dffa6317764642e2742
approved live Server SHA                        = 83424901502491c6b1dcc8fd223990f91a750d7d
current source deployed                         = NO
```

The documentation commits after `b9203e...` change documentation only. Their exact-head CI must pass before any later SHA is considered a reflection candidate.

## Canonical source evidence

Development Probe run `37299751542` checked out exact SHA `b9203e587781daa9c1869dffa6317764642e2742` directly. Artifact `11341055855` records the same SHA and canonical command `DEBUG_AI_REQUIRE_TS7_REAL=1 npm run verify`.

Observed result:

```text
tests=454
pass=454
fail=0
skipped=0
source_ready=true
server_mutation_authorized=false
```

Verify run `37299751510`, Public Readiness run `37299751493`, Runtime Volume Gate run `37299751497`, Targeted TGserver Logging run `37299751459`, Development Probe run `37299751542`, and Core Verify run `37299751516` all completed SUCCESS for the source change.

## Real isolated Sandbox full-suite evidence

Core Verify run `37299751516` executed the existing Sandbox sidecar path and produced:

```text
SANDBOX_FULL_SUITE_PASS
TESTS=454
PASS=454
FAIL=0
SKIPPED=0
BACKEND=sidecar+landlock+seccomp
SIGNAL=EXACT_SOURCE_BOUND_CHILD_ONLY
SANDBOX_DOCKER_SOCKET=ABSENT
SANDBOX_SOURCE_REPO_HASH=UNCHANGED
```

Therefore `FULL_SUITE_SANDBOX_REAL=PASS` is qualified for this source/CI isolated-runtime boundary.

The closure did not delete tests, accept skipped tests, relax Landlock/seccomp, open arbitrary environment injection, create a second Sandbox/service/runtime, or grant general signal authority. `DEBUG_AI_REQUIRE_TS7_REAL=1` is fixed only for provenance-qualified exact-source DebugAI `package.test`; ordinary Sandbox jobs and other repositories do not receive it.

## Evidence parser contract

The Full-suite gate accepts Node 24 informational summary format and legacy TAP comment format, but only when all numeric counters exist and satisfy:

```text
tests > 0
pass === tests
fail === 0
skipped === 0
```

Missing/inconsistent counters fail closed. Failure diagnostics expose only the bounded four numeric counters.

## Remaining boundary

This source/CI result does not prove the current source is live on the Server. It does not complete real current-runtime integration, fresh MCP continuation/self-debug, current-source real-model qualification, or Strict Completion.

Before live reflection:

1. documentation/current records must be synchronized and their resulting exact HEAD reverified;
2. Master must explicitly approve the exact reflection SHA;
3. current server-core deployment authority must be used;
4. volumes, checkpoints, unmanaged state and auxiliary containers must be preserved;
5. after reflection, exact live parity and a fresh real DebugAI operation must be verified.

No Merge, Deploy/recreate/restart, Secret/provider/model/profile change, Search Gate activation, or persistent-state deletion is authorized by this record.
