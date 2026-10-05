# DebugAI self-test sandbox compatibility defect

## Recorded boundary

Live source reflection to `83424901502491c6b1dcc8fd223990f91a750d7d` is approved and completed. Only the existing debug-ai service was recreated. Sandbox-runner, init containers, persistent volumes, production settings and context 8192 remain unchanged.

The production sandbox's chmod/fchmod/fchmodat, timestamp mutation and signal restrictions remain security requirements. An unsuccessful self-test is not permission to relax these restrictions.

## Evidence

- Real MCP run `run_murr1d8u_a6fb01c3d9` reproduced package.test FAIL in job `JOB_17a50d53d243b48e38a52b53`; retained deterministic evidence contains chmod EPERM in private test fixtures.
- `fs.mkdtempSync` already creates a private 0700 directory. Fixtures now assert that mode instead of executing redundant chmod.
- Permission rejection cases still create and check actual 0755/0750 directories and a 0644 record; the valid 0700/0600 cases remain checked. The writer-lock case still rejects an actual 0777 directory. No case is skipped or removed.
- Runtime retention boundary tests already advance rotate's clock beyond retention; changing file timestamps is unnecessary. Sandbox GC tests supply old/fresh mtime observations through a unit-test stat mock, retain real identities and filesystem deletions, and restore the mock. These are unit-test clock inputs, not claimed live aging measurements.
- Corrected fixture source passes the repository suite outside the isolated whole-repository sandbox. That lower evidence level does not claim a whole-sandbox PASS.
- Subsequent real sandbox job `JOB_c000535d443cbc2b498d3cce` still failed. Its retained result independently exposed missing `build/native/debugai-durable-lock.node` and utime EPERM. That job predates the timestamp fixture correction; no corrected whole-sandbox PASS is claimed.
- Snapshot copying excludes build and node_modules. Native lock loading requires a regular local addon; the historical sandbox-runner contains an addon, but the job snapshot does not. The sandbox-runner dependency tree also lacked the MCP client dev dependency. Absence is measured; a complete inventory of all failing tests is not established by the bounded output tail.
- SIGKILL restart tests explicitly kill child processes. The sandbox intentionally blocks nonzero signals. This compatibility conflict is addressed by the source candidate below without weakening the signal policy.

## Current source repair — exact-bound artifact provisioning

The current source candidate repairs native/dependency delivery through the existing sandbox job/sidecar path; it does not create a new sandbox, service, container stack or verification authority.

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

The existing Core Verify queue gate is extended through the same helper so that, after the generic queue round-trip, it enqueues the exact DebugAI source as `package.test` and requires the isolated full repository suite to finish with zero failures and zero skips. Until exact-head CI executes that gate successfully, `FULL_SUITE_SANDBOX_REAL` remains `NOT_VERIFIED`.

## Correct repair constraints

Keep the syscall policy and all test cases. Native/dependency delivery requires exact source/version binding and must use the existing runtime/job path. Never use an addon built from a different source as a silent fallback. Crash testing must retain real SIGKILL semantics and may only delegate that signal through the bounded trusted supervisor contract above. Do not replace the crash with graceful exit and do not run arbitrary repository scripts outside the sandbox merely to obtain green verification.

Source implementation does not close read-only MCP verification, real integration E2E, Strict Completion or current-production runtime qualification. DebugAI advice must be cross-checked against source and runtime observations before adoption.

Evidence artifacts from the approved live runtime remain under `/app/runtime/benchmarks/mcp-8342490`, `source-tests-sandbox-fixtures-final.log`, and `sandbox-fixture-correction-result.json`.
