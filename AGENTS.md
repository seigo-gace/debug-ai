# DebugAI Authority

## Scope
- This repository is DebugAI only.
- Do not modify Astera repositories, Astera runtime, or the Evidence Search Module implementation from this project.
- The Evidence Search Module is consumed through its API only.
- TGserver is consumed through its API only.

## Server
- Before live Server work, read the current `G-ACE-inc/server-core` authority in the mandatory order: `README.md` -> `docs/LOAD_SCOPE.md` -> task-required authority (`SERVER_CORE_PROTOCOL.md`; `docs/DEPLOY_RUNBOOK.md` only when deploy/runtime mutation is actually in scope) -> DebugAI authority.
- Do not reuse a recorded server-core SHA as future-current authority; read current server-core at execution time.
- Production/server residency is Docker Compose only.
- Do not run DebugAI as a permanent host Node/Python/systemd/PM2 process.
- DebugAI APIs must not be exposed publicly by default.
- The canonical live checkout previously recorded for server verification is `/home/admin1/projects/debug-ai`; read back the actual server state before treating it as current.
- GitHub source revision and live Server runtime are separate states. Registry/README history does not prove current runtime state.
- Do not pull, reset, merge, deploy, restart, recreate, discard local-only server changes, or change production/server state merely to make a verification pass unless Master explicitly authorizes that mutation.
- Container start, HTTP 200, build success, or green CI alone is not Runtime PASS; verify the required endpoint/output/state/side-effect boundary.
- Keep unexecuted/unverified states as `NOT_EXECUTED / UNKNOWN / NOT_VERIFIED`.

## Evidence
- Current-run logs, tool outputs, test results, diffs, and temporary evidence remain local runtime data.
- Do not send every runtime event to TGserver.
- Runtime evidence is short-lived and must have retention/rotation.

## External technical knowledge
- Programming/runtime/framework/library knowledge comes from the Evidence Search Module API.
- Prefer official specifications, official documentation, primary sources, security authorities, and upstream records.
- Do not copy external programming documentation into the DebugAI asset KB.

## TGserver asset knowledge
- TGserver stores only reusable DebugAI achievements/evidence promoted by the Asset Promotion Gate.
- Asset records may include confirmed root causes, decisive evidence, failed fixes worth avoiding, accepted fixes, validation results, regressions, invariants, environment constraints, and source references.
- Unconfirmed hypotheses and ordinary intermediate logs must not be promoted to the asset KB.
- Asset history is append-only. Corrections use supersedes/replacement references rather than silently rewriting history.

## Security
- Never persist secrets, tokens, passwords, API keys, private keys, cookies, Authorization headers, or raw .env values.
- Redact sensitive values before any external API submission or TGserver submission.

## Patch safety
- Applying a patch requires explicit approval.
- No dummy implementations, fake PASS, temporary bypasses, hidden fallbacks, or fabricated evidence.

## VS Code / Cursor / Codex entry point
- CLI contract: read `DEBUGAI.md`.
- MCP contract: read `docs/MCP_ADAPTER.md` before registering or calling DebugAI as an MCP server.
- Before any live Server qualification, read current server-core authority, then `docs/PRE_SERVER_QUALIFICATION.md` and `docs/CODEX_MCP_LIVE_HANDOFF.md`.
- `npm run audit:pre-server-qualification` is a read-only **source readiness** audit. `READY` never means Local Reviewer, six-role Skill ON/OFF, Model A/B, live integration E2E, MCP live calls, or Search Gate shadow measurement have passed on the real Server.
- DebugAI MCP is an stdio adapter over the existing CLI/HTTP/runtime; it is not a second orchestrator.
- The MCP surface exposes exactly nine guarded tools: health, analyze, durable start, resume, wait, patch-candidate, verify, status, inspect.
- MCP intentionally exposes no approve/apply shortcut.
- Durable continuation is available through explicit `run_id`; do not replace it with one-shot tool calls when a run needs continuation.
- Investigation by CLI: `debugai analyze "<request>"`.
- Read-only validation after an external Agent edits files: `debugai verify --repo <server-visible-path> [--paths <changed-files>]`.
- Treat stdout JSON as the formal result; summaries on stderr are informational.
- `debugai patch` creates a candidate only. Do not confuse read-only `debugai verify` with mutation-capable `/v1/approve-apply-verify`.
- The CLI deliberately has no apply command. Never infer approval from an analyze, patch, verify, MCP analyze, MCP patch-candidate, or MCP verify call.

## Live qualification boundary
- Source/CI/stdio protocol PASS does not prove live server/Codex registration or real-model quality.
- First prove live source/runtime compatibility read-only. If it is behind or byte-incompatible, report `RUNTIME_SOURCE_BEHIND_OR_UNKNOWN` and stop; do not sync/deploy/restart without explicit Master approval.
- Only on a compatible live runtime, follow `docs/PRE_SERVER_QUALIFICATION.md` for real Local Reviewer, six-role Skill ON/OFF, one-variable Model A/B, real integration E2E, MCP, and Search Gate shadow measurements.
- Skill ON is not assumed to win. Skill OFF wins and ties must be reported exactly as measured.
- Model A/B changes exactly one axis per comparison. Do not change the model, prompt/case/input, thinking, temperature, and token cap together.
- Model A/B measurement never authorizes a production profile change. A measured improvement remains `promotion_authorized=false` until a separate reviewed decision.
- Provider token counts remain `null` when the provider does not return them. Do not relabel estimates as measurements.

## Live MCP verification boundary
- When Master delegates live verification to VS Codex, verify the MCP sub-sequence as: tool discovery -> `debugai_health` -> bounded `debugai_start` -> `debugai_status` -> `debugai_resume` only when applicable -> bounded `debugai_wait` -> `debugai_inspect`.
- Reuse the exact returned `run_id` across continuation calls; do not manufacture a new run merely to simulate continuation.
- Do not run server sync/deploy/restart/recreate as part of discovery, benchmark, or MCP verification without explicit Master approval.
- Do not mark Workspace MCP `AVAILABLE_VERIFIED` until representative calls succeed against the real DebugAI runtime.
