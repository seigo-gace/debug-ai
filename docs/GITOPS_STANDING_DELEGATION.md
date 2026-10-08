# Guarded GitOps Standing Delegation

## Scope and trust

This extends the existing GitOps request/status service, queue, Bash Host runner and
approval mechanism. It adds no tool, executor, queue, transport or resident service.
The original thirteen MCP tools and bounded Server Commands remain unchanged.
Read-only Server Commands need no mutation receipt. Existing publish and manual
exact-SHA deploy approval remain compatible; standing delegation admits only
`deploy` / `debugai.compose.reflect` on the already-pinned DebugAI repository and
feature branch. It does not add arbitrary restart, rollback or shell operations.

The credential is **not** CHAT text, a delegation ID or `human_approved=true`.
Authority is an installed Host-only policy outside the container's `/workspace`
mount, readable only by the existing Host account. The trust root and its `policies`
directory must be owned by the executing Host UID, mode 0700, non-symlinks. Issuer
registry and policy files must be owned by that UID, mode 0600, non-symlinks.
A trusted Host administrator may provision/revoke this authority after Master
has delegated the bounded scope. API callers cannot install/change the policy.
No signing key, copied token or new provider credential is introduced.

Trust root: `/home/admin1/.config/debugai-gitops/delegations`, overridable only by
trusted Host service environment. `issuers.json` has schema
`debugai.delegation-issuers/v1` and `issuers:[{issuer,authority,enabled}]`.
`policies/<delegation_id>.json` has schema `debugai.standing-delegation/v1` and:

- `id`, `issuer`, `authority`, `audit_identity`, `request_identity`;
- `repo`, `remote`, `branch`, `allowed_operations`, `allowed_scopes`, `allowed_paths`;
- `allow_production`, `effects:{destructive,persistent_data,secrets,provider_model,public_exposure}`;
- `valid_from`, `expires_at` (Unix milliseconds), `revoked`.

This scope requires all protected effects false. Allowed paths are exact paths or
literal directory prefixes ending `/`; no regular expressions, wildcard shell
expansion, absolute paths or parent traversal. Keep executable/config path grants
minimal and source-review/CI the exact target before requesting reflection.
Compose/Docker/provider/Secret/persistent schema changes are outside the deployed
policy. Deploy preserves named volumes and existing private exposure. Policy
provisioning is a distinct trusted Host action, never a new MCP approval shortcut.

## Existing MCP request

Use `debugai_gitops_request` with the existing repo/branch/expected_head/sha/action
and `human_approved:true`, plus:

```json
{"delegation":{"id":"dlg_debugai_reflect_v1","scope":"debugai.compose.reflect"}}
```

The existing authenticated control service generates the operation ID and assigns
`debugai.authenticated-control` as the service principal; callers cannot supply a
different identity/operation ID. This principal identifies the authenticated
control lane, not an individually authenticated human or named CHAT session.
The Host policy audit identity identifies the actual installed Master delegation.

The existing Host runner verifies policy existence/trust, enabled issuer,
revocation, start/expiry, repo/remote/branch/action/scope/production/effects,
operation/request identity, request expiry, exact remote SHA, fetched SHA,
fast-forward ancestry, clean checkout and changed-file scope. Only then does it
issue `approvals/<operation_id>.approve`, schema `debugai.host-approval/v2`.

Receipt binding includes delegation/issuer/authority/audit identity, operation ID,
request principal, repo/branch/action/exact SHA/scope/production/effects, request
SHA256, policy SHA256, issuer-registry SHA256, observed Host HEAD, issuance and
expiry. Its expiry is the minimum of request expiry, policy expiry and five minutes.
Immediately before consumption, the Host revalidates current policy, issuer,
revocation, expiry, request identity/hash, remote target and local checkout state.
The existing global runner lock serializes issue/consume. Consumption atomically
moves the file to `<operation_id>.approve.used`; that marker prevents reissuance.
Fetch/SHA/ancestry are checked again before checkout/build/recreate. Policy, issuer,
request digests, revocation/expiry, remote SHA and checkout state are checked again
before build and before recreate, so a long build cannot cross a revoked grant.

A failed operation after consumption needs a new request ID and fresh receipt;
mutation is never replayed automatically. A duplicate operation is rejected into
the existing failed archive and `status/<id>.rejections.jsonl`; its original terminal
status is retained. Successful or post-consumption failed status includes the
sanitized authorization receipt and consumption timestamp through the existing
`debugai_gitops_status` tool. No credential is logged.

## Revocation, compatibility and rollback

Set `revoked:true`, expire the policy, disable its issuer, or remove the policy via
the trusted Host administration path. Already-issued receipts are rechecked and
fail closed. Every policy/issuer edit invalidates outstanding receipts by digest.
Legacy SHA-only manual receipts still authorize the existing legacy request mode;
a delegated request cannot fall back to a legacy receipt. Removing/disabling the
policy restores manual approval without a service replacement. Never delete used
markers or terminal statuses to make a replay pass.

Source/fixture/CI success does not establish live qualification. Bootstrap this
new verifier through the existing manually bound guarded reflection once, then
prove a real delegated MCP request with **no manually created per-operation
receipt**, QUEUED -> RUNNING -> PASS, exact HEAD, Docker/HTTP health, audit binding,
receipt consumption and duplicate rejection.

Regression: `node --test ops/tests/gitops-standing-delegation.test.cjs
ops/tests/server-command-host-execution.test.cjs` uses real Bash/jq; Verify CI owns
that Host-toolchain gate. Container source tests own normalization and the existing
13-tool/Server Command regressions. Host Node/Python installation is unnecessary.

## Additive Master Internal mode

Master's own development may use the separate `MASTER_INTERNAL_PERSISTENT` registry
mode described in [the internal contract](MASTER_INTERNAL_PERSISTENT_DELEGATION.md).
It has no repository-delegation expiry and uses the same short single-use receipt
mechanism. This does not delete/change the finite Standing policy or the legacy
manual/Commercial approval paths described above.
