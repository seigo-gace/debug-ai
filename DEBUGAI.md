# DebugAI external parent-agent entry points

DebugAI is used from VS Code, Cursor, Codex, ChatGPT-driven terminal work, or another parent developer agent through the `debugai` CLI, HTTP API, and the MCP adapter when that adapter is installed and verified. These are thin integration layers; debugging, evidence, verification, review, durable execution, and patch-candidate logic remain in the DebugAI Server.

## CLI setup

With Node.js 24.20.0 and this repository checked out:

```bash
npm link
debugai health
```

Without linking, use the equivalent repository command:

```bash
npm run debugai -- health
```

`DEBUGAI_URL` defaults to `http://127.0.0.1:8787`. Set it only to the private DebugAI Server URL when a different local endpoint is required.

The Server sees repositories below `/workspace`. For a normal top-level checkout, the CLI maps the local repository basename to `/workspace/<repo>`. For an explicit mapping set:

```bash
export DEBUGAI_WORKSPACE_HOST_PATH=/home/user/projects
export DEBUGAI_SERVER_WORKSPACE_ROOT=/workspace
```

## CLI commands

Health:

```bash
debugai health
```

Investigate the current repository:

```bash
debugai analyze "OAuth callback後に/loginへ戻る原因を調査"
```

Create a patch candidate after analysis. This does not apply the patch:

```bash
debugai patch "OAuth callbackのstate検証だけを修正" --paths src/auth/callback.ts
```

Run read-only verification. This never calls PatchService apply:

```bash
debugai verify --repo /workspace/my-repo --paths src/auth/callback.ts
```

Read run state and retained, redacted run artifacts:

```bash
debugai status <run-id>
debugai inspect <run-id>
```

The most recent `analyze` run ID is stored as local CLI session metadata with mode `0600`. Pass `--run-id <run-id>` to `patch` when selecting a different run. Override the state location with `DEBUGAI_STATE_FILE` when necessary.

## MCP adapter

MCP source entry:

```bash
npm run debugai:mcp
```

or after linking:

```bash
debugai-mcp
```

The MCP server uses stdio. Standard output belongs to MCP protocol traffic; operational startup information is written to standard error.

Current MCP tools:

```text
debugai_health
debugai_analyze
debugai_start
debugai_resume
debugai_wait
debugai_patch_candidate
debugai_verify
debugai_status
debugai_inspect
```

The MCP layer delegates to the existing `bin/debugai.js` execution contract. It does not contain a second workflow or state engine.

Run-scoped MCP tools require an explicit `run_id`. Repository-scoped analysis and verification require an explicit repository path so the MCP process working directory is not silently treated as the target repository.

**There is intentionally no MCP approve/apply tool.** `debugai_patch_candidate` creates a candidate only. Mutation continues to require the existing explicit approval decision and exact candidate identity through the established DebugAI mutation boundary.

MCP design/verification boundaries are documented in [`docs/MCP_ADAPTER.md`](docs/MCP_ADAPTER.md).

Source implementation or CI PASS does not prove that an external MCP host has successfully connected. Until real stdio handshake/tool discovery/call verification is complete, runtime MCP status remains `NOT_VERIFIED`.

## Output contract

CLI:
- Standard output is one JSON document and is the formal machine-readable result.
- A short human summary is written to standard error. Use `--no-summary` to suppress it.
- `verify` exits `0` only for `PASS`; `FAIL`, `UNKNOWN`, and `INSUFFICIENT_EVIDENCE` retain their JSON output and exit `2`.
- CLI or HTTP failures return `debugai.cli-error/v1` JSON and exit `1`.

MCP:
- successful tools return MCP text content containing `debugai.mcp-result/v1` JSON;
- adapter/delegated execution errors return `isError=true` with `debugai.mcp-error/v1`;
- a DebugAI business/verdict state is preserved rather than rewritten to a fabricated PASS.

## External Agent workflow

1. Start with `debugai analyze` / `debugai_start` or their MCP equivalent.
2. Read the returned evidence and causal candidates.
3. Continue through the existing guarded DebugAI workflow.
4. If a patch is required, create a candidate only.
5. Mutation remains behind explicit Master approval and exact candidate identity.
6. Run deterministic verification and inspect authoritative status/evidence.

The integration layer must not bypass evidence, revision, approval, review, or Strict Completion gates.

## Repository gate

Before claiming a source integration complete:

```bash
npm run test:e2e-fixture
npm run check
npm test
```

Repository-level acceptance uses `npm run verify` and exact-SHA CI.

Never place API keys, tokens, cookies, authorization headers, or `.env` contents in CLI or MCP tool arguments.
