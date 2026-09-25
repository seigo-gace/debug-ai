# DebugAI Server Port Matrix

Authority: `2026-09-25 15:11 JST｜新CHAT完全引継ぎ固定｜DebugAI Server再構築の最新Authority`

Scope: existing Windows/PC DebugAI -> Contabo Server `/srv/debug-ai`. Production residency is Docker Compose only. Astera implementation is out of scope. TGserver and Evidence Search Module are API-only dependencies.

## Classification rules

- `KEEP`: semantics/implementation remain authoritative.
- `PORT`: keep behavior, adapt OS/container/path/process/API boundary.
- `REPLACE`: replace an obsolete implementation while preserving the higher-level contract.
- `DROP`: do not carry into Server production runtime.
- `REVERIFY`: implementation is reused but must be proven on Linux/Docker or across a changed API boundary.

## Matrix

| Asset / responsibility | Decision | Server action | Verification |
|---|---|---|---|
| State Machine / workflow transitions | KEEP + REVERIFY | Preserve state semantics and fail-closed transitions | unit + failure-path + whole-loop |
| Contracts / schemas | KEEP + REVERIFY | Preserve canonical contracts | contract + malformed input tests |
| Debug governance / stage policy | KEEP + REVERIFY | Preserve workflow ordering and review boundaries | governance tests |
| Patch candidate generation / transactional apply | KEEP + REVERIFY | Preserve prepare/revalidate/apply transaction semantics | patch safety + rollback + rejection tests |
| Master explicit Patch Approval | KEEP + REVERIFY | Keep explicit approval mandatory; adapt input/control plane for server API | no-approval mutation=0, approval/reject/replay |
| Regression / Invariant / Acceptance gates | KEEP + REVERIFY | Preserve gates and failure closure | regression + invariant fixture tests |
| Persistent Store | KEEP + PORT + REVERIFY | Preserve durable/ephemeral split; use server-safe paths/volumes | restart/replay/dirty-state tests |
| Request durable identity replay fix | KEEP + REVERIFY | Keep `request_hash` identity independent of `created_at` observation metadata | same request x3 + concurrent replay + mismatch fail-closed |
| Runtime Evidence | PORT + REVERIFY | Linux/Docker runtime location, redaction, retention, rotation | retention/redaction/restart tests |
| Context/repository evidence selection | KEEP + REVERIFY | Preserve deterministic local evidence selection | repository fixture tests |
| Native TypeScript LSP | PORT + REVERIFY | Linux/container executable/path/process handling | real definition/reference E2E |
| DAP integration | PORT + REVERIFY | Replace Windows process/path assumptions with Linux/container adapters | real breakpoint/stack/continue E2E |
| OSV offline scan | PORT + REVERIFY | Move DB/bootstrap/cache to container volume; no paid/network fallback during scan | real offline scan + failure tests |
| Source Gate | PORT + REVERIFY | Preserve source integrity semantics; Linux path normalization | source mutation/restore tests |
| Service Ownership Gate | PORT + REVERIFY | Map ownership checks to Compose services | duplicate-owner / wrong-service failure tests |
| Managed OSS Runtime Gate | PORT + REVERIFY | Linux bootstrap/versions/license/network controls | container bootstrap + offline/restart |
| Hybrid frontend / API boundary | PORT + REVERIFY | Keep API behavior; remove Windows launcher assumptions | API contract + Docker smoke |
| Payload/hash integrity gate | KEEP + REVERIFY | Rebuild canonical Server manifest from migrated bytes | SHA manifest gate |
| Rollback | PORT + REVERIFY | Preserve transaction semantics; adapt filesystem/container paths | induced failure rollback E2E |
| PC PowerShell installer / `.cmd` / `.bat` launcher | DROP | Keep only as historical authority outside production runtime | not part of Server production gate |
| PowerShell AST gate | DROP | Windows-only installer validation is not a Server production gate | N/A |
| Host Node/Python daemon / PM2 / systemd app residency | DROP | Production uses Docker Compose only | process/service audit |
| Direct Ollama runtime/client/model routing | REPLACE | Replace with AI Core API adapter | adapter contract + unavailable/timeout tests |
| Old local model resource names | REPLACE | Preserve role contract; model/port resolution belongs to AI Core | role-to-core contract tests |
| Role chain semantics | KEEP + REVERIFY | Fixed roles: Code Scout, Causal Scout, Researcher, Diagnoser, Patch Engineer, Local Reviewer | role ordering + parallel scout tests |
| External AI use outside Hypothesis/Final Review | DROP | External AI allowed only at the two fixed review points | boundary tests |
| Existing external review boundary | PORT + REVERIFY | Preserve only Hypothesis Review and Final Review contracts; provider mechanics remain behind adapter | boundary + provider failure tests |
| Direct Telegram / Meilisearch / Redis access | DROP | Never use from DebugAI | static/source gate |
| TGserver reusable-asset persistence | REPLACE + REVERIFY | TGserver API-only Asset Adapter | contract + redaction + unavailable tests |
| Asset Promotion Gate | PORT + REVERIFY | Promote only reusable confirmed assets; never ordinary run logs/hypotheses | positive/negative promotion tests |
| Direct Astera/Evidence Search internals | DROP | No Astera repo/runtime/config mutation | source/dependency audit |
| Evidence Search Module integration | REPLACE + REVERIFY | API-only adapter for external technical authority evidence | contract + authority/source-ref tests |
| Secret redaction | KEEP + REVERIFY | Apply before external API/TGserver persistence | token/header/.env fixtures |
| Short-term evidence retention/rotation | PORT + REVERIFY | Server volume policy and bounded cleanup | retention/rotation tests |
| Existing Windows real PASS history | KEEP | Use as migration baseline, not as Server PASS | provenance only |
| Server Dockerfile / Compose / healthcheck | REPLACE + REVERIFY | New Server residency boundary replacing Windows installer | build + smoke + restart + health |

## Canonical migration order

1. Recover and hash-verify every canonical core dependency before importing the whole runtime.
2. Import platform-neutral core without semantic rewrites.
3. Replace Ollama/provider-specific mechanics with adapters while keeping role/workflow contracts.
4. Add Linux/Docker adapters for DAP, LSP, OSV, paths, services, rollback and runtime evidence.
5. Add Evidence Search Module API Adapter, TGserver Asset Adapter and Asset Promotion Gate.
6. Reconnect the fixed whole-loop.
7. Run Unit/Contract -> Integration/Failure -> Docker Smoke -> Live API E2E -> Real Repository Debug E2E -> Production Gate.

## Current reconstruction finding

The Full28 apply bundle is not a complete standalone Server source archive. It references canonical `RECOVERED_CORE` / `LATEST_KNOWN_REFERENCE` modules such as `performance-retention-core.js`, `block-core.js`, `context-core.js`, `state-machine.js`, and `symbol-core.js`. Therefore those bytes must be recovered and hash-verified before the full orchestrator is committed as runnable Server code. Importing an incomplete bundle and masking missing modules is forbidden.
