# Master Internal Persistent Delegation

## Purpose and design delta

Extend only Master's own development delegation to verified GitHub Project #1
repositories. Commercial/customer authorization, licensing, subscriptions and the
legacy full manual approval path are unchanged. This is an additive internal mode,
not a renamed or replaced sales authorization contract.

Reuse server-core's Workspace registry/routing, DebugAI's existing thirteen MCP
tools, authenticated request service, queue, Host runner, watcher and receipt
mechanism. No new executor, queue, transport, service or arbitrary shell endpoint.
Source authority: server-core `operations/master-internal-repositories.json`.
Host admission installs an exact private copy under the existing delegation
`policies/<id>.json`; every operation compares it with the canonical registry.
Changes to either copy invalidate outstanding authorization. Old
`dlg_debugai_reflect_v1` remains independently supported and is not deleted.

## Registry and mapping

Each entry records immutable GitHub numeric/node repository identities, owner,
Master authenticated GitHub principal, Project node/item/control URL, server project
identity/path, default/allowed branches, operations/scopes, Compose runtime target,
exact Compose digest/services/private health endpoint, path/effect policy, issuer,
audit identity and enabled/revoked state. Initial verified registration is DebugAI
only. Other Project repositories are not automatically granted authority.

Mapping is explicit:
GitHub repository -> exact Project item/control URL -> server project ID -> actual
canonical Host checkout path/remote -> pinned Compose file/services/health target.
Unknown/missing mappings are NOT_VERIFIED and rejected. Project registration alone
is insufficient. Host also checks the authenticated Master principal and current
repository admin permission; renamed/transferred/recreated repositories fail closed.
Registry's Master owners are an explicit allowlist, not a caller-supplied claim.

## Repository admission and lifecycle

1. Verify the Master-managed repository and its formal Project item. Obtain actual
   Host checkout, Git remote, Compose services and private health endpoint evidence.
2. Add a fully evidenced entry to server-core's existing Workspace registry JSON.
   Keep grants minimal. No expiry field is allowed for persistent delegation.
   Source-review, commit/PR/CI and read back the registry change.
3. Run the existing owner's trusted Host admission command:
   `bash /home/admin1/projects/debug-ai/scripts/host-gitops-register-master.sh ID admit`.
   It validates owner/admin/principal, Project identity/membership, exact mapping,
   Compose digest/services, every allowed branch and issuer. It installs an exact
   private entry atomically, reads it back and appends a sanitized lifecycle audit
   to the existing delegation trust root. This command does not deploy anything.
4. Query subsequent operations through the existing DebugAI MCP. Natural CHAT text
   cannot install a policy, provide credentials, override a Host path or principal.

`ID disable` and `ID revoke` on that same admission command immediately block the
Host entry, including issued but unconsumed receipts and pre-recreate checks.
Synchronize the same state in the canonical registry via the normal source flow.
Re-admission is an explicit trusted Host administration action against reviewed
registry state; no weekly/monthly Master renewal is required. Missing GitHub access
or removed Project membership rejects execution rather than using cached authority.
Project membership reads are bounded to 1000 items; entries outside that readback
are unverified and rejected. Admission is serialized separately from the existing
execution lock; a concurrent registry edit fails the digest/readback gates.

## Existing MCP request

The request's `repo` remains `/workspace/debug-ai`: this identifies the existing
control queue, not a caller-selected execution directory. The target repository
and runtime are registry identifiers, resolved only by the Host.

```json
{
  "action": "deploy",
  "repo": "/workspace/debug-ai",
  "branch": "feat/tgserver-async-log-sink-20261003",
  "sha": "EXACT_40_HEX_REMOTE_SHA",
  "expected_head": "EXACT_40_HEX_REMOTE_SHA",
  "human_approved": true,
  "delegation": {
    "id": "dlg_master_debugai_v1",
    "mode": "MASTER_INTERNAL_PERSISTENT",
    "repository": "seigo-gace/debug-ai",
    "scope": "debugai.compose.reflect",
    "runtime_target": "debugai.compose"
  }
}
```

The service generates a fresh operation ID and the existing authenticated-control
principal. Caller identity, operation IDs, effects and Host paths are rejected.
Existing request/status/13-tool transport contracts remain intact.

## Every-operation validation and receipt

Host freshly validates enabled/unrevoked registry, private file ownership/modes,
issuer, canonical entry equality, actual repo identity/owner/default branch/admin
permission, Master principal, current Project item, actual server path/remote,
Compose digest/services, requested branch/action/scope/runtime/effects/principal/ID
and request expiry. It separately checks exact remote SHA, fetched SHA, clean
checkout, fast-forward ancestry and changed paths. Protected configuration/Secret
paths are forbidden even when a path-prefix grant would otherwise match them.
Policy/Project/mapping/target/request are checked again before receipt consumption,
build and after the build before production recreate. GitHub outages fail closed.

Repository delegation persists until disable/revoke. Execution receipt remains
`debugai.host-approval/v2`, <=5 minutes and single-use, bound to repo/branch/SHA,
operation/ID/scope/principal, request/policy/issuer digests and observed pre-HEAD.
Persistent receipts additionally bind Project, repo numeric identity, server mapping,
runtime identity and delegation mode. Atomic `.approve.used` consumption and terminal
status/rejection records prevent replay/reissuance. A consumed receipt authorizes
one execution; revalidation after long builds does not reuse it for another operation.
Status exposes sanitized authority/audit metadata, never credentials.

The bounded operation currently supported is Compose `deploy`/reflection, including
recreate of registered existing services at a qualified exact branch head. It keeps
the existing fast-forward contract; an arbitrary rollback/shell endpoint is not
introduced. Source/test/CI work continues through normal repository development.
Register additional supported Compose repositories only after actual mapping and
scope verification. Important product/spec/user-visible/public/cost/provider/model/
Secret-authority/destructive persistent effects remain Master-owned decisions.

## Compatibility, verification and recovery

Requests without persistent mode retain legacy behavior. Legacy manual SHA receipt
consumption is unchanged. Existing finite Standing requests retain their original
issuer/expiry/branch/scope semantics. A failed persistent request never falls back
to manual/Commercial authorization. Disabling internal authority does not disable
legacy mode. No Commercial implementation, Customer authentication or Astera sales
path is changed. Existing Docker Compose residency, volumes, private exposure and
unit dispatch remain intact.

Real Bash/jq tests cover valid registry admission/lifecycle, invalid owner/Project/
mapping/status/operation, short receipts, metadata tamper, stale checkout, replay,
Project removal during build and all existing legacy/Standing/Server Command tests.
Canonical tests cover normalization and the unchanged thirteen-tool surface.
Source/CI/build are separate from live E2E. Runtime completion requires actual MCP
QUEUED -> RUNNING -> PASS, automatic receipt, exact HEAD, health, audit, replay
rejection and source/image readback. Preserve failed receipts; recover with a new
request ID after correcting source/registry and qualifying the exact target.

## Compatible Master-only bootstrap and concurrent source isolation

The existing simple MCP `delegation:{id,scope}` reference also works for an
installed Master persistent entry. The Host reads its mode/repository/runtime from
the exact private/canonical registry, never from CHAT or ID naming. All fresh
owner/Project/mapping/branch/SHA/effect/receipt checks still apply. Explicit-mode
requests require their repository/runtime identifiers to match. Existing finite
Standing and manual references retain their original semantics.

If the shared feature branch advances with another Change Unit, register a dedicated
Master runtime branch at the qualified in-scope source. Do not reflect unrelated
source or rewind the shared branch. For the initial verifier upgrade, trusted AI
may prepare the live checkout from that exact reviewed/CI-qualified revision after
checking remote, ancestry, clean state and the actual changed-path policy. The
existing MCP request and existing watcher/runner then perform the formal automatic
receipt/build/recreate/health cycle. Record source preparation separately from
Runtime completion; the later real MCP E2E is mandatory.
