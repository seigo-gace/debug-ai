# DebugAI Current Verified State

This document is the current-state companion to `README.md` and the design authority. It records the latest verified implementation/runtime boundary without rewriting historical design decisions.

## Authority separation

```text
Design / architecture              = docs/DURABLE-CONTINUATION-DESIGN.md
Current implementation/runtime     = this document
CLI / parent-agent usage           = DEBUGAI.md
MCP transport contract             = docs/MCP_ADAPTER.md
Qualification contract             = docs/PRE_SERVER_QUALIFICATION.md
Live MCP handoff                   = docs/CODEX_MCP_LIVE_HANDOFF.md
Server/VPS/Docker operations       = current G-ACE-inc/server-core authority
```

GitHub source and live Server state are separate facts.

## Current repository state

Implementation anchor before this documentation synchronization:

```text
repository                  = seigo-gace/debug-ai
branch                      = feat/pre-server-benchmark-gates-20261001
implementation anchor       = c2355f8dd7628e717db1bba83725b33360796828
PR                          = #34
PR state                    = OPEN / DRAFT / UNMERGED
base branch                 = feat/search-gate-shadow-audit-cli-20261001
base SHA                    = cfbe2908bb6190bc5f5c894779c4d0f08f51b80e
```

Implementation verification at that anchor:

```text
Public Readiness Audit #359 = SUCCESS
Verify #394                = SUCCESS
Tests                      = 373/373 PASS
Core Verify #395           = SUCCESS
pre-server source audit    = source_ready=true
control-plane audit        = 18/18 IMPLEMENTED / 0 UNRESOLVED
MCP tools                  = exact 9 guarded tools
runtime-image asset test   = PASS
server mutation authority  = false in source audit by design
production profile promote = false by design
```

The documentation synchronization commit is intentionally separate from the implementation anchor so README/document edits do not pretend to be new runtime implementation evidence.

## Runtime-image correction closed in source

Read-only Server inspection revealed that the old deployed image could be healthy while lacking Current qualification assets. The current source fixed that packaging gap.

Current runtime-image contract now includes:

```text
server/
orchestrator/
bin/
mcp/
scripts/
docs/
package.json
```

The Server-local `.debugai-input/` path is excluded from Docker build context.

Regression tests prove:

```text
runtime image carries live qualification and MCP source assets = PASS
server-local debug input excluded from Docker build context    = PASS
```

Core Verify #395 also rebuilt the image and passed real-container health plus existing sandbox/DAP/queue/Compose gates.

## Real Server readback

Last confirmed read-only state before Current source reflection:

```text
checkout path              = /home/admin1/projects/debug-ai
checkout branch            = feat/durable-role-continuation-final-20260928
checkout HEAD              = df261bdae3b6f259ac428a173b798fae2fb68bdf
worktree untracked         = .debugai-input/
.debugai-input tracked     = 0 files
.debugai-input size        = 48K
host node/npm              = not installed
```

Host Node/npm absence is not itself a runtime defect because production residency is Docker Compose.

Running containers:

```text
debug-ai-debug-ai-1        = Up / healthy
debug-ai-sandbox-runner-1  = Up
DebugAI container Node     = v24.20.0
DebugAI workdir            = /app
DebugAI command            = node server/main.js
loopback /health           = ok=true / service=debug-ai
```

Old running image did not contain:

```text
/app/scripts/live-runtime-readback.cjs
/app/scripts/pre-server-qualification-audit.cjs
/app/server/control/model-ab-benchmark.js
/app/server/control/skill-effect-suite.js
```

Therefore the correct Current-source verdict remains:

```text
OLD_RUNTIME_HEALTHY=YES
CURRENT_SOURCE_DEPLOYED=NO
LIVE_RUNTIME_SOURCE_STATE=RUNTIME_SOURCE_BEHIND_OR_UNKNOWN
```

Do not relabel the old Runtime health as Current-source live qualification PASS.

## Current implementation capabilities

Implemented/verified source boundary includes:

- six fixed internal roles through shared AI Core;
- role-specific Skill procedures and bounded Tool Runtime;
- deterministic evidence registry and claim/evidence binding;
- Evidence Projection / Active Evidence Window;
- `evidence.read`, `runtime.trace.read`, `state.read`, `history.read`, `invariant.read`, `source.verify`;
- durable RunAuthority, native writer lock, generation/epoch fencing;
- durable read-only effect reuse and Researcher A/B/C/D/E continuation;
- real SIGKILL continuation regression;
- patch/review packets;
- exact candidate/approval/revision/application boundaries;
- Strict Completion Gate;
- runtime evidence retention/archive/GC safety;
- local/official/TGserver/Evidence Search boundaries;
- guarded CLI/HTTP surface;
- exact nine-tool MCP stdio adapter;
- real stdio MCP protocol test;
- Search Gate provider-preserving shadow instrumentation/audit;
- Local Reviewer benchmark;
- six-role Skill ON/OFF suite;
- one-variable Model A/B harness for `thinking`, `temperature`, `top_p`, `top_k`, `max_tokens`;
- exact source/runtime live-readback gate;
- runtime-image qualification/MCP asset packaging.

## Explicitly not complete

```text
CURRENT_SERVER_SOURCE_REFLECTION     = NOT_EXECUTED
CURRENT_RUNTIME_EXACT_PARITY         = NOT_VERIFIED
LOCAL_REVIEWER_REAL                  = NOT_EXECUTED
SKILL_EFFECT_ALL_REAL                = NOT_EXECUTED
MODEL_AB_THINKING_REAL               = NOT_EXECUTED
MODEL_AB_SAMPLING_REAL               = NOT_EXECUTED
MODEL_AB_TOKEN_CAP_REAL              = NOT_EXECUTED
REAL_INTEGRATION_E2E                 = NOT_EXECUTED
MCP_LIVE                             = NOT_VERIFIED
VS_CODEX_MCP_REGISTRATION            = NOT_VERIFIED
SEARCH_GATE_SHADOW_REAL              = NOT_EXECUTED
FALSE_SKIP_ZERO_PROVEN               = NO
SEARCH_SKIP_ACTIVATION               = NO
FRESH_CURRENT_RUNTIME_SELF_DEBUG     = NOT_EXECUTED
FINAL_PRODUCTION_EQUIVALENT_E2E      = NOT_EXECUTED
MAIN_MERGE                           = NO
PRODUCTION_PROFILE_CHANGE            = NONE
```

## Master authorization boundary

On 2026-10-01, after requesting README and companion-document synchronization, Master explicitly authorized continuation into the Server source-reflection phase once documentation work is complete.

Authorized next mutation scope:

```text
Current branch/source reflection into existing DebugAI Server checkout
Docker build/recreate required to run Current source
post-change health/source-parity/read-only qualification
```

Not implied by that authorization:

```text
PR #34 merge to main
force reset/destructive cleanup
removal of .debugai-input/
Secret changes
provider-resource changes
new model downloads
Search Gate skip activation
production model/profile promotion
unrelated project changes
```

All Server operations remain subject to current `G-ACE-inc/server-core` rules and actual live preconditions.

## Required next-work order

```text
1. re-read only the current server-core authority required for authorized mutation
2. preserve .debugai-input and verify no tracked/local-only source changes are being discarded
3. reflect exact authorized Current DebugAI source into /home/admin1/projects/debug-ai
4. build/recreate the required DebugAI Compose services
5. verify container health, command/workdir, exact source parity, and Current qualification assets
6. run audit:pre-server-qualification
7. run audit:live-runtime
8. run Local Reviewer real measurement
9. run six-role Skill ON/OFF real suite
10. run one-variable Model A/B: Thinking where eligible -> Sampling -> token cap
11. run a bounded real allowed-repository integration case
12. verify MCP exact nine tools + health + durable start/status/resume-if-applicable/wait/inspect
13. evaluate real Search Gate shadow without activation
14. run fresh current-runtime self-development/self-debug case
15. run final production-equivalent closed-loop E2E
16. update this document/README/Notion from actual measured results
```

Every unexecuted item stays unexecuted until real evidence exists.
