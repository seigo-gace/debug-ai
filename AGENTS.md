# DebugAI Authority

## Scope
- This repository is DebugAI only.
- Do not modify Astera repositories, Astera runtime, or the Evidence Search Module implementation from this project.
- The Evidence Search Module is consumed through its API only.
- TGserver is consumed through its API only.

## Server
- Production/server residency is Docker Compose only.
- Do not run DebugAI as a permanent host Node/Python/systemd/PM2 process.
- DebugAI APIs must not be exposed publicly by default.
- The canonical live checkout previously recorded for server verification is `/home/admin1/projects/debug-ai`; read back the actual server state before treating it as current.
- Do not pull, reset, merge, deploy, restart, recreate, or change production/server state merely to make a verification pass unless Master explicitly authorizes that mutation.

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
- DebugAI MCP is an stdio adapter over the existing CLI/HTTP/runtime; it is not a second orchestrator.
- The MCP surface exposes exactly nine guarded tools: health, analyze, durable start, resume, wait, patch-candidate, verify, status, inspect.
- MCP intentionally exposes no approve/apply shortcut.
- Durable continuation is available through explicit `run_id`; do not replace it with one-shot tool calls when a run needs continuation.
- Investigation by CLI: `debugai analyze "<request>"`.
- Read-only validation after an external Agent edits files: `debugai verify --repo <server-visible-path> [--paths <changed-files>]`.
- Treat stdout JSON as the formal result; summaries on stderr are informational.
- `debugai patch` creates a candidate only. Do not confuse read-only `debugai verify` with mutation-capable `/v1/approve-apply-verify`.
- The CLI deliberately has no apply command. Never infer approval from an analyze, patch, verify, MCP analyze, MCP patch-candidate, or MCP verify call.

## Live MCP verification boundary
- Source/CI/stdio protocol PASS does not prove live server/Codex registration.
- When Master delegates live verification to VS Codex, verify in this order: tool discovery -> `debugai_health` -> bounded `debugai_start` -> `debugai_status` -> `debugai_resume` only when applicable -> bounded `debugai_wait` -> `debugai_inspect`.
- Do not run server sync/deploy/restart/recreate as part of discovery or MCP verification without explicit Master approval.
- Do not mark Workspace MCP `AVAILABLE_VERIFIED` until representative calls succeed against the real DebugAI runtime.
