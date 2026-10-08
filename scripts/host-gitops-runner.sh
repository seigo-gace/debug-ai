#!/usr/bin/env bash
set -u
set -o pipefail

REPO="${DEBUG_AI_HOST_REPO:-/home/admin1/projects/debug-ai}"
CONTAINER_REPO="/workspace/debug-ai"
REMOTE="https://github.com/seigo-gace/debug-ai.git"
BRANCH="feat/tgserver-async-log-sink-20261003"
QUEUE="$REPO/.debugai-input/gitops"
APPROVAL_ROOT="${DEBUG_AI_GITOPS_APPROVAL_ROOT:-/home/admin1/.config/debugai-gitops/approvals}"
GIT_BIN="${DEBUG_AI_GITOPS_GIT_BIN:-git}"
DOCKER_BIN="${DEBUG_AI_GITOPS_DOCKER_BIN:-docker}"
JQ_BIN="${DEBUG_AI_GITOPS_JQ_BIN:-jq}"
CURL_BIN="${DEBUG_AI_GITOPS_CURL_BIN:-curl}"
TIMEOUT_BIN="${DEBUG_AI_GITOPS_TIMEOUT_BIN:-timeout}"

err_code=""
request_id=""
request_action=""
expected_head=""
request_sha=""
result_json="{}"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/host-gitops-delegation.sh" || exit 1

fail() {
  err_code="${1:-ERROR}"
  return 1
}

ensure_dir() {
  mkdir -p -- "$1" && chmod 700 -- "$1"
}

atomic_json() {
  local target="$1" json="$2" tmp
  ensure_dir "$(dirname -- "$target")" || return 1
  tmp="${target}.tmp-$$-$(date +%s%N)"
  (umask 077; printf '%s\n' "$json" >"$tmp") || return 1
  mv -f -- "$tmp" "$target"
}

run_timed() {
  local seconds="$1"; shift
  "$TIMEOUT_BIN" --signal=TERM --kill-after=5s "$seconds" "$@"
}

git_cmd() {
  (cd "$REPO" && run_timed "${DEBUG_AI_GITOPS_GIT_TIMEOUT:-30s}" "$GIT_BIN" "$@")
}

docker_cmd() {
  (cd "$REPO" && run_timed "${DEBUG_AI_GITOPS_DOCKER_TIMEOUT:-30s}" "$DOCKER_BIN" "$@")
}

changed_paths() {
  {
    git_cmd diff --name-only
    git_cmd diff --cached --name-only
    git_cmd ls-files --others --exclude-standard
  } | sed '/^$/d;/^\.debugai-input\//d' | LC_ALL=C sort -u
}

subset_of_file() {
  local values="$1" allow_file="$2" value
  while IFS= read -r value; do
    [ -z "$value" ] && continue
    grep -Fxq -- "$value" "$allow_file" || return 1
  done <<<"$values"
}

common_validate() {
  local file="$1" now_ms remote_url remote_head expires
  "$JQ_BIN" -e '
    .schema=="debugai.gitops-request/v1" and
    (.id|type=="string" and test("^gitops_[0-9a-f]{24}$")) and
    (.action=="publish" or .action=="deploy") and
    (.expected_head|type=="string" and test("^[0-9a-f]{40}$")) and
    .repo=="/workspace/debug-ai" and
    .branch=="feat/tgserver-async-log-sink-20261003" and
    .human_approved==true and
    (.expires_at|type=="number")
  ' "$file" >/dev/null || fail REQUEST_SCHEMA_OR_BOUNDARY_INVALID || return 1

  request_id="$("$JQ_BIN" -r '.id' "$file")"
  request_action="$("$JQ_BIN" -r '.action' "$file")"
  expected_head="$("$JQ_BIN" -r '.expected_head' "$file")"
  expires="$("$JQ_BIN" -r '.expires_at|floor' "$file")"
  now_ms="$(date +%s%3N)"
  [ "$now_ms" -le "$expires" ] || fail REQUEST_EXPIRED || return 1

  remote_url="$(git_cmd remote get-url origin 2>/dev/null)" || fail REMOTE_READ_FAILED || return 1
  [ "$remote_url" = "$REMOTE" ] || fail REMOTE_IDENTITY_MISMATCH || return 1
  remote_head="$(git_cmd ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | awk 'NR==1{print $1}')" || fail REMOTE_HEAD_READ_FAILED || return 1
  [ "$remote_head" = "$expected_head" ] || fail REMOTE_HEAD_DRIFT || return 1
}

validate_publish_file() {
  local value="$1" lower part
  [ -n "$value" ] || return 1
  [[ "$value" != /* ]] || return 1
  IFS='/' read -r -a parts <<<"$value"
  for part in "${parts[@]}"; do
    [ "$part" != ".." ] || return 1
    [ "$part" != ".git" ] || return 1
    [ "$part" != ".env" ] || return 1
    [ "$part" != ".debugai-input" ] || return 1
    lower="${part,,}"
    [[ "$lower" != *secret* ]] || return 1
    [[ "$lower" != *.key ]] || return 1
  done
}

publish_request() {
  local file="$1" allow_file changed staged before_head after_head remote_head
  local candidate_hash candidate_id commit_message
  common_validate "$file" || return 1
  [ "$(git_cmd rev-parse HEAD 2>/dev/null)" = "$expected_head" ] || fail LOCAL_HEAD_MISMATCH || return 1
  "$JQ_BIN" -e '(.files|type=="array" and length>0 and length<=64) and (.commit_message|type=="string" and length>0 and length<=160) and (.candidate_hash|type=="string" and test("^[0-9a-f]{64}$")) and (.candidate_id|type=="string" and test("^patch_[0-9a-f]{24}$"))' "$file" >/dev/null || fail PUBLISH_REQUEST_INVALID || return 1

  candidate_hash="$("$JQ_BIN" -r '.candidate_hash' "$file")"
  candidate_id="$("$JQ_BIN" -r '.candidate_id' "$file")"
  [ "$candidate_id" = "patch_${candidate_hash:0:24}" ] || fail GITOPS_CANDIDATE_IDENTITY_INVALID || return 1
  commit_message="$("$JQ_BIN" -r '.commit_message' "$file")"

  allow_file="$(mktemp)" || { fail PUBLISH_ALLOWLIST_TEMP_FAILED; return 1; }
  trap 'rm -f -- "$allow_file"; trap - RETURN' RETURN
  "$JQ_BIN" -r '.files[]' "$file" | LC_ALL=C sort -u >"$allow_file"
  while IFS= read -r value; do
    validate_publish_file "$value" || fail GITOPS_FILE_FORBIDDEN || return 1
  done <"$allow_file"

  changed="$(changed_paths)" || fail PUBLISH_CHANGED_PATHS_READ_FAILED || return 1
  [ -n "$changed" ] || fail PUBLISH_NO_SOURCE_CHANGES || return 1
  subset_of_file "$changed" "$allow_file" || fail PUBLISH_SCOPE_DRIFT || return 1

  mapfile -t files <"$allow_file"
  git_cmd add -A -- "${files[@]}" >/dev/null 2>&1 || fail PUBLISH_STAGE_FAILED || return 1
  staged="$(git_cmd diff --cached --name-only)" || fail PUBLISH_STAGED_READ_FAILED || return 1
  [ -n "$staged" ] || fail PUBLISH_STAGED_SCOPE_INVALID || return 1
  subset_of_file "$staged" "$allow_file" || fail PUBLISH_STAGED_SCOPE_INVALID || return 1

  before_head="$expected_head"
  (cd "$REPO" && run_timed 120s "$GIT_BIN" commit -m "$commit_message" -- "${files[@]}") >/dev/null 2>&1 || fail PUBLISH_COMMIT_FAILED || return 1
  after_head="$(git_cmd rev-parse HEAD 2>/dev/null)" || fail PUBLISH_HEAD_READ_FAILED || return 1
  [[ "$after_head" =~ ^[0-9a-f]{40}$ ]] && [ "$after_head" != "$before_head" ] || fail PUBLISH_COMMIT_INVALID || return 1
  (cd "$REPO" && run_timed 180s "$GIT_BIN" push origin "HEAD:refs/heads/$BRANCH") >/dev/null 2>&1 || fail PUBLISH_PUSH_FAILED || return 1
  remote_head="$(git_cmd ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | awk 'NR==1{print $1}')" || fail PUBLISH_REMOTE_READ_FAILED || return 1
  [ "$remote_head" = "$after_head" ] || fail PUBLISH_REMOTE_READBACK_MISMATCH || return 1

  result_json="$("$JQ_BIN" -n --arg before "$before_head" --arg after "$after_head" --arg remote "$remote_head" --argjson files "$("$JQ_BIN" -Rsc 'split("\n")|map(select(length>0))' <<<"$staged")" '{before_head:$before,after_head:$after,remote_head:$remote,files:$files}')"
}

consume_approval() {
  local file="$1" approved used
  ensure_dir "$APPROVAL_ROOT" || return 1
  [ -f "$file" ] || fail DEPLOY_HOST_APPROVAL_REQUIRED || return 1
  approved="$(tr -d '\r\n' <"$file")"
  [ "$approved" = "$request_sha" ] || fail DEPLOY_HOST_APPROVAL_SHA_MISMATCH || return 1
  used="${file}.$(date +%s%3N).used"
  mv -- "$file" "$used" || fail DEPLOY_APPROVAL_CONSUME_FAILED || return 1
}

wait_health() {
  local deadline=$((SECONDS + 120)) code container_id state
  while [ "$SECONDS" -lt "$deadline" ]; do
    code="$("$CURL_BIN" -sS -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:8787/health 2>/dev/null || true)"
    if [[ "$code" =~ ^2[0-9][0-9]$ ]]; then
      container_id="$(docker_cmd compose ps -q debug-ai 2>/dev/null | head -n1)"
      state=""
      if [ -n "$container_id" ]; then
        state="$(docker_cmd inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}NONE{{end}}' "$container_id" 2>/dev/null || true)"
      fi
      if [ "$state" = "running|healthy" ]; then
        printf 'HTTP_%s\n' "$code"
        return 0
      fi
    fi
    sleep 2
  done
  fail DEPLOY_HEALTH_TIMEOUT
}

deploy_request() {
  local file="$1" changed fetched health_http container_id state approval_file before_head
  common_validate "$file" || return 1
  "$JQ_BIN" -e '(.sha|type=="string" and test("^[0-9a-f]{40}$")) and .sha==.expected_head' "$file" >/dev/null || fail DEPLOY_SHA_INVALID || return 1
  request_sha="$("$JQ_BIN" -r '.sha' "$file")"
  before_head="$(git_cmd rev-parse HEAD 2>/dev/null)" || fail DEPLOY_CURRENT_HEAD_READ_FAILED || return 1
  [[ "$before_head" =~ ^[0-9a-f]{40}$ ]] || fail DEPLOY_CURRENT_HEAD_INVALID || return 1

  changed="$(changed_paths)" || fail DEPLOY_CHANGED_PATHS_READ_FAILED || return 1
  [ -z "$changed" ] || fail DEPLOY_WORKTREE_NOT_CLEAN || return 1
  approval_file="$APPROVAL_ROOT/${request_id}.approve"
  if "$JQ_BIN" -e 'has("delegation")' "$file" >/dev/null; then
    # Read-only fetch admits the exact source for scope inspection. Existing
    # fetch/SHA/ancestry gates are repeated after receipt consumption.
    validate_standing_delegation "$file" || return 1
    (cd "$REPO" && run_timed 120s "$GIT_BIN" fetch --no-tags origin "refs/heads/$BRANCH") >/dev/null 2>&1 || fail DEPLOY_FETCH_FAILED || return 1
    [ "$(git_cmd rev-parse FETCH_HEAD)" = "$request_sha" ] || fail DEPLOY_FETCH_HEAD_MISMATCH || return 1
    git_cmd merge-base --is-ancestor "$before_head" "$request_sha" >/dev/null 2>&1 || fail DEPLOY_NON_FAST_FORWARD_TARGET || return 1
    issue_delegated_receipt "$file" "$before_head" "$approval_file" || return 1
    consume_delegated_receipt "$file" "$approval_file" || return 1
  else
    consume_approval "$approval_file" || return 1
  fi

  (cd "$REPO" && run_timed 120s "$GIT_BIN" fetch --no-tags origin "refs/heads/$BRANCH") >/dev/null 2>&1 || fail DEPLOY_FETCH_FAILED || return 1
  fetched="$(git_cmd rev-parse FETCH_HEAD 2>/dev/null)" || fail DEPLOY_FETCH_HEAD_READ_FAILED || return 1
  [ "$fetched" = "$request_sha" ] || fail DEPLOY_FETCH_HEAD_MISMATCH || return 1
  git_cmd merge-base --is-ancestor "$before_head" "$request_sha" >/dev/null 2>&1 || fail DEPLOY_NON_FAST_FORWARD_TARGET || return 1
  git_cmd checkout --detach "$request_sha" >/dev/null 2>&1 || fail DEPLOY_CHECKOUT_FAILED || return 1

  delegated_execution_gate "$file" || return 1
  (cd "$REPO" && run_timed 1800s "$DOCKER_BIN" compose build debug-ai sandbox-runner) >/dev/null 2>&1 || fail DEPLOY_BUILD_FAILED || return 1
  delegated_execution_gate "$file" || return 1
  (cd "$REPO" && run_timed 180s "$DOCKER_BIN" compose up -d --no-deps --force-recreate debug-ai sandbox-runner) >/dev/null 2>&1 || fail DEPLOY_RECREATE_FAILED || return 1
  health_http="$(wait_health)" || return 1
  container_id="$(docker_cmd compose ps -q debug-ai 2>/dev/null | head -n1)" || fail DEPLOY_CONTAINER_ID_READ_FAILED || return 1
  [ -n "$container_id" ] || fail DEPLOY_CONTAINER_ID_MISSING || return 1
  state="$(docker_cmd inspect -f '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}NONE{{end}}' "$container_id" 2>/dev/null)" || fail DEPLOY_CONTAINER_STATE_READ_FAILED || return 1
  [ "$state" = "running|healthy" ] || fail "DEPLOY_CONTAINER_NOT_HEALTHY:$state" || return 1
  result_json="$("$JQ_BIN" -n --arg before "$before_head" --arg sha "$request_sha" --arg health "$health_http" --arg state "$state" '{before_head:$before,deployed_sha:$sha,health_http:$health,container_state:$state}')"
}

process_file() {
  local source="$1" processing done_dir failed_dir started finished status id_for_status
  started="$(date +%s%3N)"
  processing="$QUEUE/processing/$(basename -- "$source")"
  done_dir="$QUEUE/done"
  failed_dir="$QUEUE/failed"
  ensure_dir "$QUEUE/processing" || return 1
  ensure_dir "$done_dir" || return 1
  ensure_dir "$failed_dir" || return 1
  mv -- "$source" "$processing" || return 1

  # Replay never overwrites the original terminal result or reissues approval.
  local replay_id
  replay_id="$("$JQ_BIN" -r '.id // ""' "$processing" 2>/dev/null || true)"
  if [[ "$replay_id" =~ ^gitops_[0-9a-f]{24}$ ]] && [ -f "$QUEUE/status/$replay_id.json" ]; then
    "$JQ_BIN" -nc --arg id "$replay_id" --argjson at "$started" '{operation_id:$id,at:$at,state:"REJECTED",error:"GITOPS_OPERATION_REPLAY_REJECTED"}' >> "$QUEUE/status/$replay_id.rejections.jsonl" || return 1
    mv -- "$processing" "$failed_dir/$replay_id.duplicate.$started.json"
    return
  fi

  request_id=""
  request_action=""
  err_code=""
  result_json="{}"
  authorization_json='null'
  if "$JQ_BIN" -e . "$processing" >/dev/null 2>&1; then
    request_id="$("$JQ_BIN" -r '.id // ""' "$processing")"
    request_action="$("$JQ_BIN" -r '.action // ""' "$processing")"
  else
    err_code="REQUEST_JSON_INVALID"
  fi

  if [ -z "$err_code" ]; then
    if [ "$request_action" = "publish" ]; then
      publish_request "$processing" || true
    elif [ "$request_action" = "deploy" ]; then
      deploy_request "$processing" || true
    else
      err_code="REQUEST_ACTION_INVALID"
    fi
  fi

  finished="$(date +%s%3N)"
  id_for_status="$request_id"
  [[ "$id_for_status" =~ ^gitops_[0-9a-f]{24}$ ]] || id_for_status="invalid_${finished}"

  if [ -z "$err_code" ]; then
    status="$("$JQ_BIN" -n --arg id "$request_id" --arg action "$request_action" --argjson started "$started" --argjson finished "$finished" --argjson result "$result_json" --argjson authorization "$authorization_json" '{schema:"debugai.gitops-status/v1",id:$id,action:$action,started_at:$started,state:"PASS",finished_at:$finished,result:$result,authorization:$authorization}')"
    atomic_json "$QUEUE/status/${id_for_status}.json" "$status" || return 1
    mv -- "$processing" "$done_dir/$(basename -- "$processing")"
  else
    status="$("$JQ_BIN" -n --arg id "$id_for_status" --arg action "$request_action" --argjson started "$started" --argjson finished "$finished" --arg error "${err_code:0:240}" --argjson authorization "$authorization_json" '{schema:"debugai.gitops-status/v1",id:$id,action:$action,started_at:$started,state:"FAIL",finished_at:$finished,error:$error,authorization:$authorization}')"
    atomic_json "$QUEUE/status/${id_for_status}.json" "$status" || return 1
    mv -- "$processing" "$failed_dir/$(basename -- "$processing")"
  fi
}

main() {
  local lock_dir request_dir name count=0 cmd
  for cmd in "$GIT_BIN" "$DOCKER_BIN" "$JQ_BIN" "$CURL_BIN" "$TIMEOUT_BIN"; do
    command -v "$cmd" >/dev/null 2>&1 || { printf 'debugai-gitops-runner:DEPENDENCY_MISSING:%s\n' "$cmd" >&2; return 1; }
  done
  [ -d "$REPO/.git" ] || { printf 'debugai-gitops-runner:REPO_INVALID\n' >&2; return 1; }

  request_dir="$QUEUE/requests"
  ensure_dir "$request_dir" || return 1
  ensure_dir "$QUEUE/status" || return 1
  lock_dir="$QUEUE/.runner.lock"
  if ! mkdir -- "$lock_dir" 2>/dev/null; then return 0; fi
  trap 'rmdir -- "$lock_dir" 2>/dev/null || true' EXIT INT TERM

  while IFS= read -r name; do
    [ -n "$name" ] || continue
    process_file "$request_dir/$name" || return 1
    count=$((count + 1))
    [ "$count" -ge 8 ] && break
  done < <(find "$request_dir" -maxdepth 1 -type f -name 'gitops_*.json' -printf '%f\n' | LC_ALL=C sort)

  trap - EXIT INT TERM
  rmdir -- "$lock_dir" 2>/dev/null || true
}

main "$@"
