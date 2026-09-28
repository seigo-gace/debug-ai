# DebugAI terminal entry point

DebugAI is used from VS Code, Cursor, or Codex through the `debugai` CLI. The CLI is a thin JSON HTTP client; debugging, evidence, verification, review, and patch-candidate logic remain in the DebugAI Server.

## One-command setup

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

## Commands

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

## Output contract

- Standard output is one JSON document and is the formal machine-readable result.
- A short human summary is written to standard error. Use `--no-summary` to suppress it.
- `verify` exits `0` only for `PASS`; `FAIL`, `UNKNOWN`, and `INSUFFICIENT_EVIDENCE` retain their JSON output and exit `2`.
- CLI or HTTP failures return `debugai.cli-error/v1` JSON and exit `1`.

## External Agent workflow

1. Run `debugai analyze "<investigation request>"`.
2. Read the returned evidence and causal candidates.
3. Let Cursor or Codex edit the repository.
4. Run `debugai verify --repo <server-visible-path> [--paths <changed-files>]`.
5. On failure, use only the returned failure artifacts to make the next correction.
6. Repeat read-only verification until the evidence supports `PASS`.

`debugai patch` creates a candidate only. Read-only `debugai verify` and mutation-capable `POST /v1/approve-apply-verify` are different operations. The CLI intentionally provides no apply or approval command. Patch application continues to require a separate explicit approval carrying the exact candidate ID and hash.

## Repository gate

Before a live repository run:

```bash
npm run test:e2e-fixture
npm run check
npm test
```

Never place API keys, tokens, cookies, authorization headers, or `.env` contents in CLI arguments.
