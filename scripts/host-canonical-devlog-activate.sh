#!/usr/bin/env bash
set -u
set -o pipefail

REPO="${DEBUG_AI_HOST_REPO:-/home/admin1/projects/debug-ai}"
TGS="/home/admin1/projects/TGserver"
RESULT="$REPO/.debugai-input/canonical-devlog-activation/result.json"
LOG="$REPO/.debugai-input/canonical-devlog-activation/run.log"
EXPECTED="0bbd3b2a6fa90f7f9ceca92945f28f482524b809"
BRANCH="ops/canonical-devlog-runtime-readback-20261007"
started="$(date +%s%3N)"

mkdir -p -- "$(dirname -- "$RESULT")"
chmod 700 -- "$(dirname -- "$RESULT")"

finish(){
  local state="$1" error="${2:-}" verify="${3:-}" event_id="${4:-}" exit_code="${5:-1}" actual="${6:-}"
  local tmp="${RESULT}.tmp-$$"
  jq -n --arg state "$state" --arg error "$error" --arg verify "$verify" --arg event_id "$event_id" --arg expected "$EXPECTED" --arg actual "$actual" --arg log ".debugai-input/canonical-devlog-activation/run.log" --argjson exit_code "$exit_code" --argjson started "$started" --argjson finished "$(date +%s%3N)" '{schema:"debugai.canonical-devlog-activation/v1",state:$state,error:$error,verify:$verify,event_id:$event_id,helper_expected:$expected,helper_actual:$actual,exit_code:$exit_code,log_path:$log,started_at:$started,finished_at:$finished}' >"$tmp" && mv -f -- "$tmp" "$RESULT"
}

fail(){ finish FAIL "$1" "" "" 1 "${2:-}"; exit 1; }

[ -d "$TGS/.git" ] || fail TGS_CHECKOUT_MISSING
git -C "$TGS" fetch --quiet --no-tags origin "$BRANCH" || fail TGS_HELPER_FETCH_FAILED
actual="$(git -C "$TGS" rev-parse FETCH_HEAD 2>/dev/null || true)"
[ "$actual" = "$EXPECTED" ] || fail TGS_HELPER_HEAD_MISMATCH "$actual"

: >"$LOG"
chmod 600 "$LOG"
git -C "$TGS" show "$EXPECTED:scripts/canonical-devlog-runtime-activate.sh" | bash >"$LOG" 2>&1
rc=$?

verify="$(sed -n 's/^VERIFY=//p' "$LOG" | tail -n1)"
event_id="$(sed -n 's/^CANONICAL_EVENT_ID=//p' "$LOG" | tail -n1)"
error="$(sed -n 's/^ERROR=//p' "$LOG" | tail -n1)"

if [ "$rc" -ne 0 ]; then
  [ -n "$error" ] || error="ACTIVATION_SCRIPT_FAILED"
  finish FAIL "$error" "$verify" "$event_id" "$rc" "$actual"
  exit "$rc"
fi

[ "$verify" = "CANONICAL_DEVLOG_ACTIVATION_GATEWAY_DURABLE_PASS" ] || { finish FAIL ACTIVATION_VERIFY_MISMATCH "$verify" "$event_id" 2 "$actual"; exit 2; }
[[ "$event_id" =~ ^[0-9a-f]{64}$ ]] || { finish FAIL CANONICAL_EVENT_ID_INVALID "$verify" "" 3 "$actual"; exit 3; }

finish PASS "" "$verify" "$event_id" 0 "$actual"
