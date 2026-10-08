#!/usr/bin/env bash
# Sourced only by the existing bounded GitOps runner. No executor or transport.
DELEGATION_ROOT="${DEBUG_AI_GITOPS_DELEGATION_ROOT:-/home/admin1/.config/debugai-gitops/delegations}"
authorization_json='null'

trusted_delegation_dir() {
  [ -d "$1" ] && [ ! -L "$1" ] && [ "$(stat -c '%u:%a' -- "$1")" = "$(id -u):700" ]
}
trusted_delegation_file() {
  [ -f "$1" ] && [ ! -L "$1" ] && [ "$(stat -c '%u:%a' -- "$1")" = "$(id -u):600" ]
}
delegation_digest() { sha256sum -- "$1" | cut -d' ' -f1; }

validate_standing_delegation() {
  local request="$1" id now error
  id="$("$JQ_BIN" -r '.delegation.id // ""' "$request")"
  [[ "$id" =~ ^dlg_[a-z0-9_-]{1,64}$ ]] || fail DELEGATION_REQUIRED || return 1
  trusted_delegation_dir "$DELEGATION_ROOT" && trusted_delegation_dir "$DELEGATION_ROOT/policies" || fail DELEGATION_TRUST_ROOT_INVALID || return 1
  delegation_policy="$DELEGATION_ROOT/policies/$id.json"
  trusted_delegation_file "$DELEGATION_ROOT/issuers.json" && trusted_delegation_file "$delegation_policy" || fail DELEGATION_POLICY_UNTRUSTED || return 1
  now="$(date +%s%3N)"
  error="$("$JQ_BIN" -r --argjson now "$now" --slurpfile p "$delegation_policy" --slurpfile a "$DELEGATION_ROOT/issuers.json" '
    $p[0] as $p | $a[0] as $a |
    if $p.schema!="debugai.standing-delegation/v1" or $a.schema!="debugai.delegation-issuers/v1" then "DELEGATION_POLICY_INVALID"
    elif ($p.issuer|type)!="string" or ($p.authority|type)!="string" or
      ($a.issuers|type)!="array" or ([ $a.issuers[] | select(.issuer==$p.issuer and .authority==$p.authority and .enabled==true) ]|length)!=1 then "DELEGATION_ISSUER_INVALID"
    elif $p.revoked!=false then "DELEGATION_REVOKED"
    elif ($p.valid_from|type)!="number" or ($p.expires_at|type)!="number" or $p.valid_from>$now or $p.expires_at<=$now then "DELEGATION_EXPIRED_OR_NOT_STARTED"
    elif $p.id!=.delegation.id then "DELEGATION_ID_MISMATCH"
    elif $p.repo!=.repo or $p.remote!="https://github.com/seigo-gace/debug-ai.git" then "DELEGATION_REPOSITORY_MISMATCH"
    elif $p.branch!=.branch then "DELEGATION_BRANCH_MISMATCH"
    elif ($p.allowed_operations|type)!="array" or ($p.allowed_operations|index("deploy"))==null or .action!="deploy" then "DELEGATION_OPERATION_MISMATCH"
    elif ($p.allowed_scopes|type)!="array" or ($p.allowed_scopes|index("debugai.compose.reflect"))==null or .delegation.scope!="debugai.compose.reflect" then "DELEGATION_SCOPE_MISMATCH"
    elif $p.allow_production!=true or .delegation.production!=true then "DELEGATION_PRODUCTION_FORBIDDEN"
    elif $p.effects!={destructive:false,persistent_data:false,secrets:false,provider_model:false,public_exposure:false} or .delegation.effects!=$p.effects then "DELEGATION_PROTECTED_EFFECT_FORBIDDEN"
    elif .delegation.operation_id!=.id then "DELEGATION_OPERATION_ID_MISMATCH"
    elif .delegation.request_identity!=$p.request_identity or $p.request_identity!="debugai.authenticated-control" then "DELEGATION_REQUEST_IDENTITY_MISMATCH"
    elif (.sha|type)!="string" or .sha!=.expected_head then "DELEGATION_SHA_MISMATCH"
    elif ($p.audit_identity|type)!="string" or ($p.audit_identity|length)<1 or
      ($p.allowed_paths|type)!="array" or ($p.allowed_paths|length)<1 or
      any($p.allowed_paths[]; type!="string" or length<1 or startswith("/") or contains("..") or contains("\\")) then "DELEGATION_POLICY_INVALID"
    elif (.expires_at|type)!="number" or .expires_at<=$now then "DELEGATION_REQUEST_EXPIRED"
    else "PASS" end' "$request" 2>/dev/null)" || fail DELEGATION_POLICY_INVALID || return 1
  [ "$error" = PASS ] || fail "$error" || return 1
}

validate_delegation_paths() {
  local paths="$1" value
  while IFS= read -r value; do
    [ -z "$value" ] && continue
    "$JQ_BIN" -e --arg path "$value" 'any(.allowed_paths[]; . as $allowed | if endswith("/") then $path|startswith($allowed) else $path==$allowed end)' "$delegation_policy" >/dev/null || fail DELEGATION_CHANGED_PATH_FORBIDDEN || return 1
  done <<<"$paths"
}

issue_delegated_receipt() {
  local request="$1" before="$2" receipt="$3" paths now expires json
  validate_standing_delegation "$request" || return 1
  paths="$(git_cmd diff --name-only "$before" "$request_sha")" || fail DELEGATION_TARGET_DIFF_FAILED || return 1
  validate_delegation_paths "$paths" || return 1
  [ ! -e "$receipt.used" ] && [ ! -L "$receipt.used" ] && [ ! -e "$receipt" ] && [ ! -L "$receipt" ] || fail DELEGATION_RECEIPT_ALREADY_EXISTS_OR_USED || return 1
  now="$(date +%s%3N)"
  expires="$("$JQ_BIN" -nr --argjson now "$now" --slurpfile r "$request" --slurpfile p "$delegation_policy" '[$r[0].expires_at,$p[0].expires_at,($now+300000)]|min')" || fail DELEGATION_RECEIPT_INVALID || return 1
  json="$("$JQ_BIN" -n --slurpfile r "$request" --slurpfile p "$delegation_policy" --arg digest "$(delegation_digest "$request")" --arg policy_digest "$(delegation_digest "$delegation_policy")" --arg issuer_digest "$(delegation_digest "$DELEGATION_ROOT/issuers.json")" --arg before "$before" --argjson now "$now" --argjson expires "$expires" '
    $r[0] as $r | $p[0] as $p | {schema:"debugai.host-approval/v2",delegation_id:$p.id,issuer:$p.issuer,authority:$p.authority,audit_identity:$p.audit_identity,request_identity:$r.delegation.request_identity,operation_id:$r.id,operation:$r.action,repo:$r.repo,branch:$r.branch,sha:$r.sha,scope:$r.delegation.scope,production:$r.delegation.production,effects:$r.delegation.effects,issued_at:$now,expires_at:$expires,request_digest:$digest,policy_digest:$policy_digest,issuer_digest:$issuer_digest,target_before_head:$before}')" || fail DELEGATION_RECEIPT_INVALID || return 1
  ensure_dir "$APPROVAL_ROOT" || return 1
  (umask 077; set -C; printf '%s\n' "$json" > "$receipt") || fail DELEGATION_RECEIPT_CREATE_FAILED || return 1
}

consume_delegated_receipt() {
  local request="$1" receipt="$2" now error before remote changed
  validate_standing_delegation "$request" || return 1
  [ ! -e "$receipt.used" ] && [ ! -L "$receipt.used" ] || fail DELEGATION_RECEIPT_REUSED || return 1
  trusted_delegation_file "$receipt" || fail DELEGATION_RECEIPT_UNTRUSTED || return 1
  now="$(date +%s%3N)"
  before="$(git_cmd rev-parse HEAD)" || fail DELEGATION_TARGET_STATE_READ_FAILED || return 1
  remote="$(git_cmd ls-remote origin "refs/heads/$BRANCH" | awk 'NR==1{print $1}')" || fail DELEGATION_REMOTE_READ_FAILED || return 1
  changed="$(changed_paths)" || fail DELEGATION_TARGET_STATE_READ_FAILED || return 1
  [ "$remote" = "$request_sha" ] && [ -z "$changed" ] || fail DELEGATION_TARGET_STATE_CHANGED || return 1
  error="$("$JQ_BIN" -r --slurpfile r "$request" --slurpfile p "$delegation_policy" --arg digest "$(delegation_digest "$request")" --arg policy_digest "$(delegation_digest "$delegation_policy")" --arg issuer_digest "$(delegation_digest "$DELEGATION_ROOT/issuers.json")" --arg before "$before" --argjson now "$now" '
    $r[0] as $r | $p[0] as $p |
    if .schema!="debugai.host-approval/v2" then "DELEGATION_RECEIPT_INVALID"
    elif (.issued_at|type)!="number" or (.expires_at|type)!="number" or .issued_at>$now or .expires_at<=$now or .expires_at>$p.expires_at or .expires_at>$r.expires_at or .expires_at>(.issued_at+300000) then "DELEGATION_RECEIPT_EXPIRED"
    elif .operation_id!=$r.id then "DELEGATION_RECEIPT_OPERATION_ID_MISMATCH"
    elif .request_identity!=$r.delegation.request_identity then "DELEGATION_RECEIPT_REQUEST_IDENTITY_MISMATCH"
    elif .sha!=$r.sha then "DELEGATION_RECEIPT_SHA_MISMATCH"
    elif .request_digest!=$digest or .policy_digest!=$policy_digest or .issuer_digest!=$issuer_digest or .target_before_head!=$before then "DELEGATION_TARGET_STATE_CHANGED"
    elif .delegation_id!=$p.id or .issuer!=$p.issuer or .authority!=$p.authority or .audit_identity!=$p.audit_identity or .operation!=$r.action or .repo!=$r.repo or .branch!=$r.branch or .scope!=$r.delegation.scope or .production!=$r.delegation.production or .effects!=$r.delegation.effects then "DELEGATION_RECEIPT_BINDING_MISMATCH"
    else "PASS" end' "$receipt" 2>/dev/null)" || fail DELEGATION_RECEIPT_INVALID || return 1
  [ "$error" = PASS ] || fail "$error" || return 1
  # Global existing runner lock serializes issue/consume; immutable used marker
  # prevents a duplicate operation from minting a replacement receipt.
  mv -- "$receipt" "$receipt.used" || fail DELEGATION_RECEIPT_CONSUME_FAILED || return 1
  authorization_json="$("$JQ_BIN" --argjson consumed "$now" '. + {receipt_consumed_at:$consumed}' "$receipt.used")" || fail DELEGATION_RECEIPT_INVALID || return 1
}
