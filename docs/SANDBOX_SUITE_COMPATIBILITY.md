# DebugAI self-test sandbox compatibility defect

## Current closure status — 2026-10-05

The source/CI isolated-runtime compatibility defect described in this document is now closed for source `b9203e587781daa9c1869dffa6317764642e2742`.

Core Verify run `37299751516` executed the existing Sandbox sidecar path and reported:

```text
SANDBOX_SOURCE_REPO_HASH=UNCHANGED
SANDBOX_DOCKER_SOCKET=ABSENT
SANDBOX_REAL_ISOLATION=PASS
SANDBOX_STRICT_SOCKET_DENY=PASS
SANDBOX_DAP_LOOPBACK_ONLY=PASS
SANDBOX_FULL_SUITE_PASS
BACKEND=sidecar+landlock+seccomp
SIGNAL=EXACT_SOURCE_BOUND_CHILD_ONLY
TESTS=454
PASS=454
FAIL=0
SKIPPED=0
```

Canonical exact-head Development Probe run `37299751542` also checked out `b9203e...` directly and returned 454/454 PASS with zero failures and zero skips. Artifact `11341055855` binds that result to the exact SHA and records `source_ready=true` and `server_mutation_authorized=false`.

The closure preserves the original security requirements. No test was deleted or skipped, no syscall policy was relaxed, no arbitrary Sandbox environment passthrough was introduced, and no second Sandbox/service/runtime was created. `DEBUG_AI_REQUIRE_TS7_REAL=1` is injected only for provenance-qualified exact-source DebugAI `package.test`; ordinary Sandbox jobs and other repositories do not receive it.

The Full-suite summary gate now parses both Node 24 informational and legacy TAP-comment summary formats numerically and requires all four counters with `tests > 0`, `pass === tests`, `fail === 0`, and `skipped === 0`. Missing or inconsistent counters fail closed. Failure messages expose only the bounded numeric summary evidence.

`FULL_SUITE_SANDBOX_REAL=PASS` is therefore valid at the source/CI isolated-runtime boundary. This does not claim that the current feature-branch SHA is deployed to the live DebugAI Server and does not itself close real current-runtime integration or Strict Completion.

## Recorded boundary

Live source reflection to `83424901502491c6b1dcc8fd223990f91a750d7d` is approved and completed. Only the existing debug-ai service was recreated. Sandbox-runner, init containers, persistent volumes, production settings and context 8192 remain unchanged.

The production sandbox's chmod/fchmod/fchmodat, timestamp mutation and signal restrictions remain security requirements. An unsuccessful self-test is not permission to relax these restrictions.

## Evidence

- Real MCP run `run_murr1d8u_a6fb01c3d9` reproduced package.test FAIL in job `JOB_17a50d53d243b48e38a52b53`; retained deterministic evidence contains chmod EPERM in private test fixtures.
- `fs.mkdtempSync` already creates a private 0700 directory. Fixtures now assert that mode instead of executing redundant chmod.
- Permission rejection cases still create and check actual 0755/0750 directories and a 0644 record; the valid 0700/0600 cases remain checked. The writer-lock case still rejects an actual 0777 directory. No case is skipped or removed.
- Runtime retention boundary tests already advance rotate's clock beyond retention; changing file timestamps is unnecessary. Sandbox GC tests supply old/fresh mtime observations through a unit-test stat mock, retain real identities and filesystem deletions, and restore the mock. These are unit-test clock inputs, not claimed live aging measurements.
- Corrected fixture source passes the repository suite outside the isolated whole-repository sandbox. That lower evidence level does not claim a whole-sandbox PASS.
- Subsequent real sandbox job `JOB_c000535d443cbc2b498d3cce` still failed. Its retained result independently exposed missing `build/native/debugai-durable-lock.node` and utime EPERM. That job predates the timestamp fixture correction; no corrected whole-sandbox PASS is claimed at that historical boundary.
- Snapshot copying excludes build and node_modules. Native lock loading requires a regular local addon; the historical sandbox-runner contains an addon, but the job snapshot does not. The sandbox-runner dependency tree also lacked the MCP client dev dependency. Absence was measured; a complete inventory of all failing tests was not established by the bounded output tail.
- SIGKILL restart tests explicitly kill child processes. The sandbox intentionally blocks nonzero signals. This compatibility conflict is addressed by the source repair below without weakening the signal policy.

## Current source repair — exact-bound artifact provisioning

The source repair delivers native/dependency artifacts through the existing sandbox job/sidecar path; it does not create a new sandbox, service, container stack or verification authority.

- the durable native build emits `debugai-durable-lock.provenance.json` beside the addon;
- provenance binds the addon hash to the exact native source, native build script, pinned Node contract, Node header hash and compiler-version hash;
- the sandbox-runner image carries the addon plus provenance and installs the Project's declared production + dev dependencies from the same `package.json`;
- sandbox dependency provenance binds the installed tree to the exact `package.json`, Node version, platform and architecture;
- only a DebugAI `package.test` snapshot with matching source/package provenance receives the artifacts;
- `node_modules` is exposed through a trusted snapshot symlink to the existing read-only `/app/node_modules` Landlock allowance, preserving the existing filesystem security policy;
- the native addon is copied into the disposable job snapshot only after exact provenance checks;
- source/package/artifact mismatch fails closed; there is no stale-binary fallback;
- other repositories do not receive DebugAI artifacts.

## Current source repair — exact-bound supervised SIGKILL

The crash-test compatibility gap is handled without permitting nonzero signal syscalls inside the restricted sandbox process.

- seccomp continues to deny nonzero `kill`, `tkill`, `tgkill` and `pidfd_send_signal` from restricted code;
- only an exact-source DebugAI `package.test` job that already passed artifact provenance validation enables supervised SIGKILL;
- the existing sandbox-runner trusted side starts one temporary signal supervisor for that job only;
- the supervisor uses a random per-job token and accepts only `SIGKILL` requests for a target process whose environment carries the same token;
- the token is injected only into the restricted test command and inherited by its descendants; the sidecar and supervisor are not valid signal targets;
- generic sandbox jobs, other repositories and DAP jobs do not receive this interface;
- outside the isolated sandbox, the test helper preserves the original direct `child.kill("SIGKILL")` behavior so the test semantics are unchanged;
- malformed requests, wrong tokens, unsupported signals and unbound target PIDs fail closed without signaling;
- no new service, Compose project, server directory, persistent runtime or external control path is introduced.

The existing Core Verify queue gate is extended through the same helper so that, after the generic queue round-trip, it enqueues the exact DebugAI source as `package.test` and requires the isolated full repository suite to finish with zero failures and zero skips.

The first exact-source full-suite execution reached `result.pass=true`, `code=0`, the expected `sidecar+landlock+seccomp` boundary, and `EXACT_SOURCE_BOUND_CHILD_ONLY` supervision. Its Core Verify gate then exposed a summary-format defect because the evidence parser recognized only legacy `# fail 0` / `# skipped 0` lines while Node 24 emits informational `ℹ fail 0` / `ℹ skipped 0` lines. The repaired gate parses the terminal summary numerically, requires `tests`, `pass`, `fail`, and `skipped`, and fails closed when counters are missing or inconsistent. Both Node 24 informational and legacy TAP-comment formats are regression-tested. Exact-head Core Verify later passed the repaired gate with the 454/454 result recorded in the closure section above.

A second exact-source diagnostic run established that one test was being skipped because the canonical TypeScript 7 real-test condition was not present in the isolated command environment. The correction does not open arbitrary environment inheritance: the existing trusted side fixes `DEBUG_AI_REQUIRE_TS7_REAL=1` only after the exact-source DebugAI `package.test` provenance and supervised-SIGKILL scope are established. Regression tests prove that ordinary Sandbox environment output does not contain the variable and that an unqualified request cannot enable it.

## Correct repair constraints

Keep the syscall policy and all test cases. Native/dependency delivery requires exact source/version binding and must use the existing runtime/job path. Never use an addon built from a different source as a silent fallback. Crash testing must retain real SIGKILL semantics and may only delegate that signal through the bounded trusted supervisor contract above. Do not replace the crash with graceful exit and do not run arbitrary repository scripts outside the sandbox merely to obtain green verification.

Source implementation does not close read-only MCP verification, real integration E2E, Strict Completion or current-production runtime qualification. DebugAI advice must be cross-checked against source and runtime observations before adoption.

Historical evidence artifacts from the approved live runtime remain under `/app/runtime/benchmarks/mcp-8342490`, `source-tests-sandbox-fixtures-final.log`, and `sandbox-fixture-correction-result.json`.
