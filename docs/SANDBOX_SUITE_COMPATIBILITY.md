# DebugAI self-test sandbox compatibility defect

## Recorded boundary

Live source reflection to `83424901502491c6b1dcc8fd223990f91a750d7d` is approved and completed. Only the existing debug-ai service was recreated. Sandbox-runner, init containers, persistent volumes, production settings and context 8192 remain unchanged.

The production sandbox's chmod/fchmod/fchmodat, timestamp mutation and signal restrictions remain security requirements. An unsuccessful self-test is not permission to relax these restrictions.

## Evidence

- Real MCP run `run_murr1d8u_a6fb01c3d9` reproduced package.test FAIL in job `JOB_17a50d53d243b48e38a52b53`; retained deterministic evidence contains chmod EPERM in private test fixtures.
- `fs.mkdtempSync` already creates a private 0700 directory. Fixtures now assert that mode instead of executing redundant chmod.
- Permission rejection cases still create and check actual 0755/0750 directories and a 0644 record; the valid 0700/0600 cases remain checked. The writer-lock case still rejects an actual 0777 directory. No case is skipped or removed.
- Runtime retention boundary tests already advance rotate's clock beyond retention; changing file timestamps is unnecessary. Sandbox GC tests supply old/fresh mtime observations through a unit-test stat mock, retain real identities and filesystem deletions, and restore the mock. These are unit-test clock inputs, not claimed live aging measurements.
- Corrected fixture source passes all 415 repository tests, zero skips, including the required real TS7 check, inside the existing debug-ai container.
- Subsequent real sandbox job `JOB_c000535d443cbc2b498d3cce` still failed. Its retained result independently exposed missing `build/native/debugai-durable-lock.node` and utime EPERM. That job predates the timestamp fixture correction; no corrected whole-sandbox PASS is claimed.
- Snapshot copying excludes build and node_modules. Native lock loading requires a regular local addon; the unchanged sandbox-runner contains the addon, but the job snapshot does not. The sandbox-runner dependency tree also lacks the MCP client dev dependency. Absence is measured; a complete inventory of all failing tests is not established by the bounded output tail.
- SIGKILL restart tests explicitly kill child processes. The sandbox intentionally blocks nonzero signals. This remaining compatibility conflict is source-confirmed, not yet reproduced after native asset provisioning.

## Correct repair constraints

Keep the syscall policy and all test cases. Native/dependency delivery needs exact source/version binding and must use the existing runtime/job path. Never use an addon built from a different source as a silent fallback. SIGKILL crash testing needs a controlled trusted supervisor or an explicitly qualified separate verification lane; replacing a crash with graceful exit would weaken the test. Do not run arbitrary repository scripts outside the sandbox merely to obtain green verification.

Fixture repairs alone do not close native asset delivery, MCP dependency availability, crash-test supervision, read-only MCP verification, real integration E2E or Strict Completion. DebugAI advice must be cross-checked against these source and runtime observations before adoption.

Evidence artifacts are retained in the existing runtime volume under `/app/runtime/benchmarks/mcp-8342490`, `source-tests-sandbox-fixtures-final.log`, and `sandbox-fixture-correction-result.json`.
