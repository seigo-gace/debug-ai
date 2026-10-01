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

GitHub source, CI, and live Server state are separate facts.

## Current repository state

```text
repository                  = seigo-gace/debug-ai
branch                      = feat/pre-server-benchmark-gates-20261001
PR                          = #34
PR state                    = OPEN / DRAFT / UNMERGED
base branch                 = feat/search-gate-shadow-audit-cli-20261001
base SHA                    = cfbe2908bb6190bc5f5c894779c4d0f08f51b80e
runtime-volume fix anchor   = cd3d43acabdaa4d512ec458b2df1f3735b7a0b5a
```

Earlier implementation anchor `c2355f8dd7628e717db1bba83725b33360796828` passed Public Readiness #359, Verify #394, 373/373 tests, Core Verify #395, pre-server source audit, exact-nine MCP source/stdio checks, and runtime-image asset regression.

Documentation synchronization anchor `9f072ed30a4e9c671a403ebca63e929fe2f47556` passed Public Readiness #361, Verify #396, and Core Verify #397 before the first Current Server reflection attempt.

## Runtime-image and Server-local input correction

Current runtime-image contract includes `server/`, `orchestrator/`, `bin/`, `mcp/`, `scripts/`, `docs/`, and `package.json`. The Server-local `.debugai-input/` path is excluded from Docker build context and must not be deleted by source reflection.

## First Current Server reflection result

The Server checkout was moved from old `df261bdae3b6f259ac428a173b798fae2fb68bdf` to exact documentation/source anchor `9f072ed30a4e9c671a403ebca63e929fe2f47556`, preserving `.debugai-input/`. Docker build and `docker compose up -d --force-recreate debug-ai sandbox-runner` completed far enough to create the new containers.

Measured result after recreate:

```text
Server checkout HEAD        = 9f072ed30a4e9c671a403ebca63e929fe2f47556
Server checkout mode        = detached HEAD
.debugai-input/              = preserved / untracked
sandbox-init                 = Exited (0)
sandbox-runner               = Up
debug-ai                     = Restarting
DebugAI restart count        = 19 at readback
DebugAI exit code            = 1
DebugAI OOMKilled            = false
DebugAI health               = unhealthy
127.0.0.1:8787               = not listening
/health HTTP code            = 000
```

The repeated startup failure was exact and deterministic:

```text
Error: RUNTIME_EVIDENCE_DIRECTORY_PERMISSIONS_UNSAFE
at assertPrivateDirectory (/app/server/runtime-evidence.js)
```

Therefore:

```text
CURRENT_SERVER_SOURCE_REFLECTION_9F072ED = EXECUTED
CURRENT_RUNTIME_HEALTH_9F072ED           = FAIL
CURRENT_RUNTIME_EXACT_PARITY             = NOT_VERIFIED
LOCAL_REVIEWER_REAL                      = NOT_EXECUTED
SKILL_EFFECT_ALL_REAL                    = NOT_EXECUTED
MODEL_AB_REAL                            = NOT_EXECUTED
```

Do not relabel the failed Current runtime as live qualification PASS.

## Root cause

`RuntimeEvidenceStore` deliberately requires the runtime root to be owned by the effective process user and to have no group/world permission bits. The DebugAI image creates `/app/runtime` as the non-root `node` user, but production Compose mounts the named volume `debug_ai_runtime` over that image directory. Docker volume mount semantics therefore replace the image directory ownership/mode with the volume root metadata.

Before the fix, Compose initialized only `debug_ai_sandbox_jobs`; it did not initialize `debug_ai_runtime`. Existing Core Verify real-container health used `DEBUG_AI_RUNTIME_ROOT=/tmp/debug-ai-runtime`, so it did not exercise the production named-volume boundary. This is why source/image CI could pass while the production-style recreate failed.

## Source-side runtime-volume repair

The runtime-volume repair is implemented on PR #34 after the failed live readback:

- new one-shot `runtime-init` Compose service;
- root filesystem read-only;
- network disabled;
- `no-new-privileges` enabled;
- capabilities dropped and only `CHOWN`, `FOWNER`, `DAC_OVERRIDE` added for ownership/mode repair;
- existing `debug_ai_runtime` volume preserved rather than deleted/recreated;
- volume tree ownership repaired to UID/GID `1000:1000`;
- group/world access removed;
- runtime root fixed to mode `0700`;
- `debug-ai` waits for successful `runtime-init` completion;
- `composeGate` fails closed if the runtime initialization contract disappears or is weakened;
- regression tests cover the Compose contract;
- dedicated `Runtime Volume Gate` CI intentionally seeds a root-owned `0755` named volume, repairs it, mounts it into the DebugAI image, and instantiates/writes through the real `RuntimeEvidenceStore`.

Implementation anchor for this repair:

```text
cd3d43acabdaa4d512ec458b2df1f3735b7a0b5a
```

CI for that anchor must remain separate from live Server recovery until its actual conclusion is observed.

## Current implementation capabilities

Implemented/verified source boundary includes:

- six fixed internal roles through shared AI Core;
- role-specific Skill procedures and bounded Tool Runtime;
- deterministic evidence registry and claim/evidence binding;
- Evidence Projection / Active Evidence Window;
- durable RunAuthority, native writer lock, generation/epoch fencing;
- durable read-only effect reuse and Researcher continuation;
- patch/review packets and exact approval/revision/application boundaries;
- Strict Completion Gate;
- runtime evidence retention/archive/GC safety;
- guarded CLI/HTTP surface;
- exact nine-tool MCP stdio adapter;
- Search Gate provider-preserving shadow instrumentation/audit;
- Local Reviewer benchmark;
- six-role Skill ON/OFF suite;
- one-variable Model A/B harness for `thinking`, `temperature`, `top_p`, `top_k`, `max_tokens`;
- exact source/runtime live-readback gate;
- runtime-image qualification/MCP asset packaging;
- production named-volume initialization contract.

## Explicitly not complete

```text
RUNTIME_VOLUME_FIX_SERVER_REFLECTION = NOT_EXECUTED
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

Master authorized Current DebugAI Server source reflection/build/recreate after README/document synchronization. That authorization does not include PR/main merge, destructive reset, `.debugai-input/` deletion, Secret/provider changes, new model downloads, Search Gate skip activation, production profile promotion, or unrelated project mutation.

## Required next-work order

```text
1. require source/CI PASS for the runtime-volume repair
2. preserve .debugai-input and reflect the exact repaired PR HEAD to /home/admin1/projects/debug-ai
3. rebuild/recreate the required DebugAI Compose services without deleting debug_ai_runtime
4. prove runtime-init completion, DebugAI health, port 8787 loopback health, exact source parity, and Current image assets
5. run audit:pre-server-qualification
6. run audit:live-runtime
7. run Local Reviewer real measurement
8. run six-role Skill ON/OFF real suite
9. run one-variable Model A/B: Thinking where eligible -> Sampling -> token cap
10. run bounded real allowed-repository integration
11. verify MCP exact nine tools + durable continuation
12. evaluate Search Gate real shadow without activation
13. run fresh current-runtime self-debug
14. run final production-equivalent closed-loop E2E
15. update README companion docs and Notion from measured results
```

Every unexecuted item stays unexecuted until real evidence exists.
