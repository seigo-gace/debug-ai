#!/usr/bin/env bash
# Registry validation only, sourced by the existing runner/admission command.
MASTER_REGISTRY="${DEBUG_AI_MASTER_REGISTRY:-/home/admin1/server-core/operations/master-internal-repositories.json}"
MASTER_PROJECT_ROOT="${DEBUG_AI_MASTER_PROJECT_ROOT:-/home/admin1/projects}"
GH_BIN="${DEBUG_AI_GITOPS_GH_BIN:-/home/admin1/bin/gh}"
is_master_internal() {
  local id
  if "$JQ_BIN" -e '.delegation.mode=="MASTER_INTERNAL_PERSISTENT"' "$1" >/dev/null 2>&1; then return 0; fi
  # Existing MCP simple policy references can bootstrap/migrate Master only.
  # The installed Host policy selects the mode; an ID is never authority alone.
  "$JQ_BIN" -e '.delegation.mode==null' "$1" >/dev/null 2>&1 || return 1
  id="$("$JQ_BIN" -r '.delegation.id // ""' "$1" 2>/dev/null)"
  [[ "$id" =~ ^dlg_[a-z0-9_-]{1,64}$ ]] || return 1
  trusted_delegation_file "$DELEGATION_ROOT/policies/$id.json" &&
    "$JQ_BIN" -e '.delegation_mode=="MASTER_INTERNAL_PERSISTENT"' "$DELEGATION_ROOT/policies/$id.json" >/dev/null 2>&1
}
master_gh() { run_timed 30s "$GH_BIN" "$@" 2>/dev/null; }

master_verify_mapping() {
  local entry="$1" path remote compose digest project metadata items principal error services
  trusted_delegation_file "$entry" || fail MASTER_REGISTRY_ENTRY_UNTRUSTED || return 1
  [ -f "$MASTER_REGISTRY" ] && [ ! -L "$MASTER_REGISTRY" ] || fail MASTER_REGISTRY_MISSING || return 1
  error="$("$JQ_BIN" -r --arg root "$MASTER_PROJECT_ROOT" --slurpfile registry "$MASTER_REGISTRY" '
    . as $e | $registry[0] as $r |
    if $r.schema!="gace.workspace-master-internal-registry/v1" or $r.project!={owner:"seigo-gace",number:1,node_id:"PVT_kwHODOQFoM4BEJII"} then "MASTER_REGISTRY_INVALID"
    elif $e.schema!="debugai.master-internal-delegation/v1" or $e.delegation_mode!="MASTER_INTERNAL_PERSISTENT" or ($e|has("expires_at")) then "MASTER_REGISTRY_ENTRY_INVALID"
    elif ([ $r.repositories[] | select(.id==$e.id) ]|length)!=1 or ([ $r.repositories[] | select(.id==$e.id) ][0])!=$e then "MASTER_REGISTRY_READBACK_MISMATCH"
    elif $e.master_principal!=$r.master_principal or ($r.master_owners|index($e.repository_owner))==null or $e.repository!=($e.repository_owner+"/"+($e.repository|split("/")[1])) then "MASTER_OWNER_FORBIDDEN"
    elif $e.project.owner!=$r.project.owner or $e.project.number!=$r.project.number or $e.project.node_id!=$r.project.node_id then "MASTER_PROJECT_MISMATCH"
    elif ($e.id|type)!="string" or ($e.id|test("^dlg_[a-z0-9_-]{1,64}$")|not) or
      ($e.repository|type)!="string" or ($e.repository|test("^[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+$")|not) or
      ($e.repository_id|type)!="number" or ($e.repository_node_id|type)!="string" or
      $e.remote!=("https://github.com/"+$e.repository+".git") or
      ($e.server_project_id|type)!="string" or ($e.server_project_id|test("^[A-Za-z][A-Za-z0-9_-]{1,80}$")|not) or
      ($e.server_project_path|type)!="string" or ($e.server_project_path|startswith($root+"/")|not) or
      ($e.server_project_path|ltrimstr($root+"/")|test("^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$")|not) or
      $e.repo!="/workspace/debug-ai" then "MASTER_MAPPING_INVALID"
    elif ($e.allowed_branches|type)!="array" or ($e.allowed_branches|length)<1 or any($e.allowed_branches[]; type!="string" or (test("^[A-Za-z0-9._/-]{1,160}$")|not) or startswith("-") or contains("..") or contains("@{")) then "MASTER_BRANCH_POLICY_INVALID"
    elif $e.allowed_operations!=["deploy"] or ($e.allowed_scopes|type)!="array" or ($e.allowed_scopes|length)<1 or any($e.allowed_scopes[]; type!="string" or (test("^[a-z][a-z0-9_.-]{1,80}$")|not)) then "MASTER_OPERATION_POLICY_INVALID"
    elif $e.effects!={destructive:false,persistent_data:false,secrets:false,provider_model:false,public_exposure:false} or $e.allow_production!=true then "MASTER_PROTECTED_EFFECT_FORBIDDEN"
    elif ($e.enabled|type)!="boolean" or ($e.revoked|type)!="boolean" or $e.request_identity!="debugai.authenticated-control" or ($e.audit_identity|type)!="string" or ($e.audit_identity|length)<1 then "MASTER_REGISTRY_ENTRY_INVALID"
    elif ($e.allowed_paths|type)!="array" or ($e.allowed_paths|length)<1 or any($e.allowed_paths[]; type!="string" or length<1 or startswith("/") or contains("..") or contains("\\") or contains("*") or test("(^|/)(\\.git|\\.env|compose[^/]*|Dockerfile[^/]*|package[^/]*|[^/]*[Ss]ecret[^/]*)(/|$)")) then "MASTER_PATH_POLICY_INVALID"
    elif ($e.runtime_target.id|type)!="string" or ($e.runtime_target.id|test("^[a-z][a-z0-9_.-]{1,80}$")|not) or $e.runtime_target.compose_file!="compose.yaml" or
      ($e.runtime_target.compose_digest|type)!="string" or ($e.runtime_target.compose_digest|test("^[0-9a-f]{64}$")|not) or
      ($e.runtime_target.services|type)!="array" or ($e.runtime_target.services|length)<1 or ($e.runtime_target.services|length)>8 or any($e.runtime_target.services[];type!="string" or (test("^[a-z][a-z0-9_-]{0,63}$")|not)) or
      ($e.runtime_target.services|index($e.runtime_target.health_service))==null or
      ($e.runtime_target.health_url|type)!="string" or ($e.runtime_target.health_url|test("^http://127\\.0\\.0\\.1:[0-9]{2,5}/health$")|not) then "MASTER_RUNTIME_POLICY_INVALID"
    else "PASS" end' "$entry" 2>/dev/null)" || fail MASTER_REGISTRY_INVALID || return 1
  [ "$error" = PASS ] || fail "$error" || return 1
  path="$("$JQ_BIN" -r '.server_project_path' "$entry")"
  [ -d "$path/.git" ] && [ ! -L "$path" ] && [ "$(realpath -- "$path")" = "$path" ] || fail MASTER_SERVER_MAPPING_NOT_VERIFIED || return 1
  remote="$(cd "$path" && run_timed 30s "$GIT_BIN" remote get-url origin 2>/dev/null)" || fail MASTER_SERVER_MAPPING_NOT_VERIFIED || return 1
  [ "$remote" = "$("$JQ_BIN" -r '.remote' "$entry")" ] || fail MASTER_SERVER_MAPPING_MISMATCH || return 1
  compose="$path/compose.yaml"
  [ -f "$compose" ] && [ ! -L "$compose" ] || fail MASTER_RUNTIME_MAPPING_NOT_VERIFIED || return 1
  digest="$(delegation_digest "$compose")"
  [ "$digest" = "$("$JQ_BIN" -r '.runtime_target.compose_digest' "$entry")" ] || fail MASTER_RUNTIME_MAPPING_MISMATCH || return 1
  services="$(cd "$path" && run_timed 30s "$DOCKER_BIN" compose config --services 2>/dev/null)" || fail MASTER_RUNTIME_MAPPING_NOT_VERIFIED || return 1
  "$JQ_BIN" -e --arg services "$services" 'all(.runtime_target.services[]; . as $s | ($services|split("\n")|index($s))!=null)' "$entry" >/dev/null || fail MASTER_RUNTIME_SERVICES_MISMATCH || return 1
  principal="$(master_gh api user --jq .login)" || fail MASTER_GITHUB_UNAVAILABLE || return 1
  [ "$principal" = "$("$JQ_BIN" -r '.master_principal' "$entry")" ] || fail MASTER_PRINCIPAL_MISMATCH || return 1
  metadata="$(master_gh api "repos/$("$JQ_BIN" -r '.repository' "$entry")")" || fail MASTER_REPOSITORY_NOT_VERIFIED || return 1
  "$JQ_BIN" -e --slurpfile p "$entry" '$p[0] as $p | .full_name==$p.repository and .id==$p.repository_id and .node_id==$p.repository_node_id and .owner.login==$p.repository_owner and .default_branch==$p.default_branch and .permissions.admin==true' <<<"$metadata" >/dev/null || fail MASTER_REPOSITORY_OWNER_MISMATCH || return 1
  project="$(master_gh project view 1 --owner seigo-gace --format json)" || fail MASTER_PROJECT_NOT_VERIFIED || return 1
  "$JQ_BIN" -e '.id=="PVT_kwHODOQFoM4BEJII" and .owner.login=="seigo-gace" and .number==1 and .closed==false' <<<"$project" >/dev/null || fail MASTER_PROJECT_MISMATCH || return 1
  items="$(master_gh project item-list 1 --owner seigo-gace --limit 1000 --format json)" || fail MASTER_PROJECT_NOT_VERIFIED || return 1
  "$JQ_BIN" -e --slurpfile p "$entry" '$p[0] as $p | ([.items[]|select(.id==$p.project.item_id and .content.repository==$p.repository and .content.url==$p.project.control_url)]|length)==1' <<<"$items" >/dev/null || fail MASTER_PROJECT_REPOSITORY_UNREGISTERED || return 1
}

validate_master_internal() {
  local request="$1" id error now
  id="$("$JQ_BIN" -r '.delegation.id // ""' "$request")"
  [[ "$id" =~ ^dlg_[a-z0-9_-]{1,64}$ ]] || fail MASTER_DELEGATION_ID_INVALID || return 1
  trusted_delegation_dir "$DELEGATION_ROOT" && trusted_delegation_dir "$DELEGATION_ROOT/policies" && trusted_delegation_file "$DELEGATION_ROOT/issuers.json" || fail MASTER_TRUST_ROOT_INVALID || return 1
  delegation_policy="$DELEGATION_ROOT/policies/$id.json"
  trusted_delegation_file "$delegation_policy" || fail MASTER_REGISTRY_ENTRY_UNTRUSTED || return 1
  "$JQ_BIN" -e '.enabled==true and .revoked==false' "$delegation_policy" >/dev/null || fail MASTER_DELEGATION_DISABLED_OR_REVOKED || return 1
  master_verify_mapping "$delegation_policy" || return 1
  now="$(date +%s%3N)"
  error="$("$JQ_BIN" -r --argjson now "$now" --slurpfile p "$delegation_policy" --slurpfile a "$DELEGATION_ROOT/issuers.json" '
    $p[0] as $p | $a[0] as $a | . as $r |
    if $a.schema!="debugai.delegation-issuers/v1" or ([ $a.issuers[]|select(.issuer==$p.issuer and .authority==$p.authority and .enabled==true) ]|length)!=1 then "DELEGATION_ISSUER_INVALID"
    elif .schema!="debugai.gitops-request/v1" or (.id|type)!="string" or (.id|test("^gitops_[0-9a-f]{24}$")|not) or .human_approved!=true then "MASTER_REQUEST_INVALID"
    elif .delegation.id!=$p.id then "DELEGATION_ID_MISMATCH"
    elif (.delegation.mode!=null and .delegation.mode!="MASTER_INTERNAL_PERSISTENT") then "MASTER_REQUEST_MODE_INVALID"
    elif (.delegation.mode!=null and .delegation.repository!=$p.repository) or .repo!=$p.repo then "MASTER_REQUEST_REPOSITORY_MISMATCH"
    elif ($p.allowed_branches|index($r.branch))==null then "MASTER_BRANCH_FORBIDDEN"
    elif ($p.allowed_operations|index($r.action))==null then "MASTER_OPERATION_FORBIDDEN"
    elif ($p.allowed_scopes|index($r.delegation.scope))==null then "MASTER_SCOPE_FORBIDDEN"
    elif .delegation.mode!=null and .delegation.runtime_target!=$p.runtime_target.id then "MASTER_RUNTIME_TARGET_FORBIDDEN"
    elif .delegation.effects!=$p.effects or .delegation.production!=true then "MASTER_PROTECTED_EFFECT_FORBIDDEN"
    elif .delegation.operation_id!=.id then "DELEGATION_OPERATION_ID_MISMATCH"
    elif .delegation.request_identity!=$p.request_identity then "DELEGATION_REQUEST_IDENTITY_MISMATCH"
    elif (.sha|type)!="string" or (.sha|test("^[0-9a-f]{40}$")|not) or .sha!=.expected_head then "DELEGATION_SHA_MISMATCH"
    elif (.expires_at|type)!="number" or .expires_at<=$now then "DELEGATION_REQUEST_EXPIRED"
    else "PASS" end' "$request" 2>/dev/null)" || fail MASTER_REQUEST_INVALID || return 1
  [ "$error" = PASS ] || fail "$error" || return 1
}

master_resolve_target() {
  REPO="$("$JQ_BIN" -r '.server_project_path' "$delegation_policy")"
  REMOTE="$("$JQ_BIN" -r '.remote' "$delegation_policy")"
  BRANCH="$("$JQ_BIN" -r '.branch' "$1")"
  mapfile -t master_services < <("$JQ_BIN" -r '.runtime_target.services[]' "$delegation_policy")
  master_health_service="$("$JQ_BIN" -r '.runtime_target.health_service' "$delegation_policy")"
  master_health_url="$("$JQ_BIN" -r '.runtime_target.health_url' "$delegation_policy")"
}
