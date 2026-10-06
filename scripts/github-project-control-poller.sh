#!/usr/bin/env bash
set -u
set -o pipefail

REPO="${DEBUG_AI_HOST_REPO:-/home/admin1/projects/debug-ai}"
CONTROL_REPO="seigo-gace/debug-ai"
CONTROL_TITLE="[GACE-PROJECT]"
BRANCH="feat/tgserver-async-log-sink-20261003"
CONTAINER_REPO="/workspace/debug-ai"
QUEUE="$REPO/.debugai-input/gitops"
RUNNER="$REPO/scripts/host-gitops-runner.sh"
GH_BIN="${DEBUG_AI_GITOPS_GH_BIN:-gh}"
JQ_BIN="${DEBUG_AI_GITOPS_JQ_BIN:-jq}"
TIMEOUT_BIN="${DEBUG_AI_GITOPS_TIMEOUT_BIN:-timeout}"

run_timed() {
  local seconds="$1"; shift
  "$TIMEOUT_BIN" --signal=TERM --kill-after=5s "$seconds" "$@"
}

finish_issue() {
  local number="$1" state="$2" detail="$3" body
  body="$(printf 'GACE Project control %s.\n\n%s' "$state" "$detail")"
  run_timed 30s "$GH_BIN" issue comment "$number" --repo "$CONTROL_REPO" --body "$body" >/dev/null 2>&1 || return 1
  run_timed 30s "$GH_BIN" issue close "$number" --repo "$CONTROL_REPO" --reason completed >/dev/null 2>&1 || return 1
}

process_issue() {
  local issue="$1" number author body payload remote id now expires request_file status_file request status state detail
  number="$(printf '%s' "$issue" | "$JQ_BIN" -r '.number')"
  author="$(printf '%s' "$issue" | "$JQ_BIN" -r '.author.login // ""')"
  [ "$author" = "seigo-gace" ] || { finish_issue "$number" FAIL "ERROR=CONTROL_AUTHOR_FORBIDDEN"; return 0; }
  body="$(printf '%s' "$issue" | "$JQ_BIN" -r '.body // ""')"
  payload="$(printf '%s' "$body" | "$JQ_BIN" -c . 2>/dev/null)" || { finish_issue "$number" FAIL "ERROR=CONTROL_JSON_INVALID"; return 0; }
  printf '%s' "$payload" | "$JQ_BIN" -e '
    .schema=="gace.project-control/v1" and
    (.content_url|type=="string" and test("^https://github\\.com/(seigo-gace|G-ACE-inc)/[A-Za-z0-9_.-]+/(issues|pull)/[1-9][0-9]*$")) and
    (.fields|type=="object") and
    ([.fields|keys[]|select(.!="Status" and .!="Gate" and .!="Change Unit" and .!="Mutation Owner")]|length==0) and
    ([.fields[]|select((type!="string") or length<1 or length>160 or test("[\\r\\n\\t]"))]|length==0)
  ' >/dev/null || { finish_issue "$number" FAIL "ERROR=CONTROL_PAYLOAD_INVALID"; return 0; }

  remote="$(git -C "$REPO" ls-remote origin "refs/heads/$BRANCH" 2>/dev/null | awk 'NR==1{print $1}')"
  [[ "$remote" =~ ^[0-9a-f]{40}$ ]] || { finish_issue "$number" FAIL "ERROR=REMOTE_HEAD_READ_FAILED"; return 0; }
  id="gitops_$(printf '%s' "$CONTROL_REPO:$number:$remote" | sha256sum | awk '{print substr($1,1,24)}')"
  now="$(date +%s%3N)"
  expires="$((now + 1800000))"
  request_file="$QUEUE/requests/$id.json"
  status_file="$QUEUE/status/$id.json"
  mkdir -p -- "$QUEUE/requests" "$QUEUE/status"
  chmod 700 -- "$QUEUE/requests" "$QUEUE/status"

  if [ ! -f "$request_file" ] && [ ! -f "$status_file" ]; then
    request="$("$JQ_BIN" -n --arg id "$id" --arg repo "$CONTAINER_REPO" --arg branch "$BRANCH" --arg head "$remote" --argjson created "$now" --argjson expires "$expires" --arg url "$(printf '%s' "$payload" | "$JQ_BIN" -r '.content_url')" --argjson fields "$(printf '%s' "$payload" | "$JQ_BIN" -c '.fields')" '{
      schema:"debugai.gitops-request/v1",id:$id,action:"project_update",created_at:$created,expires_at:$expires,
      repo:$repo,branch:$branch,expected_head:$head,human_approved:true,
      project_owner:"seigo-gace",project_number:1,content_url:$url,fields:$fields
    }')"
    (umask 077; printf '%s\n' "$request" >"$request_file.tmp") || return 1
    mv -f -- "$request_file.tmp" "$request_file"
  fi

  run_timed 180s "$RUNNER" >/dev/null 2>&1 || true
  [ -f "$status_file" ] || { finish_issue "$number" FAIL "ERROR=CONTROL_STATUS_MISSING"; return 0; }
  status="$(cat "$status_file")"
  state="$(printf '%s' "$status" | "$JQ_BIN" -r '.state // "FAIL"')"
  if [ "$state" = "PASS" ]; then
    detail="$(printf '%s' "$status" | "$JQ_BIN" -c '{request_id:.id,action:.action,state:.state,result:.result}')"
    finish_issue "$number" PASS "$detail"
  else
    detail="$(printf '%s' "$status" | "$JQ_BIN" -c '{request_id:.id,action:.action,state:.state,error:.error}')"
    finish_issue "$number" FAIL "$detail"
  fi
}

main() {
  local cmd lock issues issue count=0
  for cmd in "$GH_BIN" "$JQ_BIN" "$TIMEOUT_BIN" git sha256sum; do
    command -v "$cmd" >/dev/null 2>&1 || { printf 'debugai-project-control:DEPENDENCY_MISSING:%s\n' "$cmd" >&2; return 1; }
  done
  [ -d "$REPO/.git" ] && [ -x "$RUNNER" ] || { printf 'debugai-project-control:REPO_OR_RUNNER_INVALID\n' >&2; return 1; }
  lock="$QUEUE/.project-control.lock"
  mkdir -p -- "$QUEUE"
  if ! mkdir -- "$lock" 2>/dev/null; then return 0; fi
  trap 'rmdir -- "$lock" 2>/dev/null || true' EXIT INT TERM

  issues="$(run_timed 30s "$GH_BIN" issue list --repo "$CONTROL_REPO" --state open --search "in:title $CONTROL_TITLE" --limit 20 --json number,title,body,author,url)" || return 1
  while IFS= read -r issue; do
    [ -n "$issue" ] || continue
    process_issue "$issue" || return 1
    count=$((count + 1))
    [ "$count" -ge 4 ] && break
  done < <(printf '%s' "$issues" | "$JQ_BIN" -c --arg title "$CONTROL_TITLE" '.[]|select(.title==$title)')

  trap - EXIT INT TERM
  rmdir -- "$lock" 2>/dev/null || true
}

main "$@"
