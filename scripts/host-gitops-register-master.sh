#!/usr/bin/env bash
# Trusted Host registry admission/lifecycle only. Never executes/deploys a request.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/host-gitops-delegation.sh"
source "$(dirname "${BASH_SOURCE[0]}")/host-gitops-master-internal.sh"
JQ_BIN=jq
GIT_BIN=git
DOCKER_BIN=docker
TIMEOUT_BIN=timeout
fail() { printf '%s\n' "$1" >&2; return 1; }
run_timed() { local seconds="$1"; shift; "$TIMEOUT_BIN" --signal=TERM --kill-after=5s "$seconds" "$@"; }
[[ "${1:-}" =~ ^dlg_[a-z0-9_-]{1,64}$ ]] || { fail MASTER_DELEGATION_ID_INVALID; exit 1; }
action="${2:-admit}"
[[ "$action" = admit || "$action" = disable || "$action" = revoke ]] || { fail MASTER_REGISTRY_ACTION_INVALID; exit 1; }
trusted_delegation_dir "$DELEGATION_ROOT" && trusted_delegation_dir "$DELEGATION_ROOT/policies" && trusted_delegation_file "$DELEGATION_ROOT/issuers.json" || { fail MASTER_TRUST_ROOT_INVALID; exit 1; }
lock="$DELEGATION_ROOT/.registry-admission.lock"
mkdir "$lock" || { fail MASTER_REGISTRY_BUSY; exit 1; }
candidate="$(mktemp "$DELEGATION_ROOT/policies/.admission-XXXXXX")"
trap 'rm -f "$candidate"; rmdir "$lock"' EXIT
if [[ "$action" = admit ]]; then
  jq -e --arg id "$1" '[.repositories[]|select(.id==$id)]|if length==1 then .[0] else error("MASTER_REGISTRY_ENTRY_UNKNOWN") end' "$MASTER_REGISTRY" > "$candidate"
  chmod 600 "$candidate"
  master_verify_mapping "$candidate"
  jq -e --slurpfile a "$DELEGATION_ROOT/issuers.json" '. as $p | $a[0].schema=="debugai.delegation-issuers/v1" and ([$a[0].issuers[]|select(.issuer==$p.issuer and .authority==$p.authority and .enabled==true)]|length)==1' "$candidate" >/dev/null
  # Confirm every allowed branch exists; no expiry or operation receipt is installed.
  while IFS= read -r branch; do
    observed="$(cd "$(jq -r '.server_project_path' "$candidate")" && run_timed 30s git ls-remote origin "refs/heads/$branch")"
    [[ "$observed" =~ ^[0-9a-f]{40}[[:space:]] ]] || { fail MASTER_BRANCH_NOT_VERIFIED; exit 1; }
  done < <(jq -r '.allowed_branches[]' "$candidate")
else
  trusted_delegation_file "$DELEGATION_ROOT/policies/$1.json" || { fail MASTER_REGISTRY_ENTRY_UNTRUSTED; exit 1; }
  jq -e --arg action "$action" 'select(.delegation_mode=="MASTER_INTERNAL_PERSISTENT") | if $action=="disable" then .enabled=false else .revoked=true end' "$DELEGATION_ROOT/policies/$1.json" > "$candidate"
fi
# Reject unsafe/aliased destinations before atomic installation.
target="$DELEGATION_ROOT/policies/$1.json"
[ ! -L "$target" ] || { fail MASTER_REGISTRY_ENTRY_UNTRUSTED; exit 1; }
chmod 600 "$candidate"
digest="$(delegation_digest "$candidate")"
mv "$candidate" "$target"
[ "$(delegation_digest "$target")" = "$digest" ] || { fail MASTER_REGISTRY_READBACK_MISMATCH; exit 1; }
# Sanitized audit contains scope/mapping/lifecycle identities, never credentials.
(umask 077; jq -c --arg action "$action" --arg digest "$digest" --argjson at "$(date +%s%3N)" '{at:$at,action:$action,entry_digest:$digest,id,repository,repository_id,repository_owner,project,server_project_id,server_project_path,runtime_target:.runtime_target.id,allowed_branches,allowed_operations,allowed_scopes,delegation_mode,enabled,revoked,audit_identity}' "$target" >> "$DELEGATION_ROOT/master-registry-audit.jsonl")
jq '{state:"READBACK_VERIFIED",id,repository,delegation_mode,enabled,revoked,server_project_id,runtime_target:.runtime_target.id}' "$target"
