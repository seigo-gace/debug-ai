#!/usr/bin/env bash
set -u
set -o pipefail
REPO="${DEBUG_AI_HOST_REPO:-/home/admin1/projects/debug-ai}"
RESULT="$REPO/.debugai-input/asteria-baseline-probe/result.json"
DOCKER_BIN="${DEBUG_AI_SERVER_COMMAND_DOCKER_BIN:-docker}"
CURL_BIN="${DEBUG_AI_SERVER_COMMAND_CURL_BIN:-curl}"
JQ_BIN="${DEBUG_AI_SERVER_COMMAND_JQ_BIN:-jq}"
OPENSSL_BIN="${DEBUG_AI_SERVER_COMMAND_OPENSSL_BIN:-openssl}"
GIT_BIN="${DEBUG_AI_SERVER_COMMAND_GIT_BIN:-git}"
ASTERIA_REPO="${DEBUG_AI_ASTERIA_REPO:-/home/admin1/projects/asteria}"
ASTERIA_WORKTREE="${DEBUG_AI_ASTERIA_WORKTREE:-/home/admin1/projects/.asteria-ab-67c8f87}"
ASTERIA_SHA="67c8f87fedcd7e39a57d79262e2cdc1a9b4438fd"
ASTERIA_IMAGE="asteria-ab:67c8f87"
started="$(date +%s%3N)"
finish(){ local state="$1" error="${2:-}" c1="${3:-}" c6="${4:-}" gb="${5:-}" ga="${6:-}" qb="${7:-}" qa="${8:-}" tmp="${RESULT}.tmp-$$"; "$JQ_BIN" -n --arg state "$state" --arg error "$error" --arg c1 "$c1" --arg c6 "$c6" --arg gb "$gb" --arg ga "$ga" --arg qb "$qb" --arg qa "$qa" --argjson started "$started" --argjson finished "$(date +%s%3N)" '{schema:"debugai.asteria-baseline-probe/v1",state:$state,error:$error,started_at:$started,finished_at:$finished,case1:$c1,case6:$c6,granite_before:$gb,granite_after:$ga,qwen_before:$qb,qwen_after:$qa}' >"$tmp" && mv -f -- "$tmp" "$RESULT"; }
read_evt(){ "$DOCKER_BIN" exec "$1" sh -lc 'awk "$1==\"high\"||$1==\"max\"||$1==\"oom\"||$1==\"oom_kill\"{printf \"%s=%s|\",$1,$2}" /sys/fs/cgroup/memory.events' 2>/dev/null; }
CID="$("$DOCKER_BIN" ps -q -f name=^/asteria-ab-baseline-forensic$ 2>/dev/null | head -n1)"
if [ -z "$CID" ]; then
  SAVED_CID="$("$DOCKER_BIN" ps -aq -f name=^/asteria-ab-baseline-forensic$ 2>/dev/null | head -n1)"
  if [ -n "$SAVED_CID" ]; then
    "$DOCKER_BIN" start "$SAVED_CID" >/dev/null 2>&1 || { finish FAIL ASTERIA_FORENSIC_CONTAINER_RESTART_FAILED; exit 2; }
    CID="$SAVED_CID"
  else
    if ! "$DOCKER_BIN" image inspect "$ASTERIA_IMAGE" >/dev/null 2>&1; then
      [ -d "$ASTERIA_REPO/.git" ] || { finish FAIL ASTERIA_SOURCE_REPO_NOT_FOUND; exit 2; }
      if [ -e "$ASTERIA_WORKTREE" ]; then
        [ -d "$ASTERIA_WORKTREE" ] || { finish FAIL ASTERIA_WORKTREE_INVALID; exit 2; }
      else
        "$GIT_BIN" -C "$ASTERIA_REPO" cat-file -e "$ASTERIA_SHA^{commit}" >/dev/null 2>&1 || "$GIT_BIN" -C "$ASTERIA_REPO" fetch --no-tags origin "$ASTERIA_SHA" >/dev/null 2>&1 || { finish FAIL ASTERIA_EXACT_SHA_FETCH_FAILED; exit 2; }
        "$GIT_BIN" -C "$ASTERIA_REPO" worktree add --detach "$ASTERIA_WORKTREE" "$ASTERIA_SHA" >/dev/null 2>&1 || { finish FAIL ASTERIA_WORKTREE_CREATE_FAILED; exit 2; }
      fi
      WT_HEAD="$("$GIT_BIN" -C "$ASTERIA_WORKTREE" rev-parse HEAD 2>/dev/null)"
      [ "$WT_HEAD" = "$ASTERIA_SHA" ] || { finish FAIL ASTERIA_WORKTREE_HEAD_MISMATCH; exit 2; }
      [ -z "$("$GIT_BIN" -C "$ASTERIA_WORKTREE" status --porcelain 2>/dev/null)" ] || { finish FAIL ASTERIA_WORKTREE_DIRTY; exit 2; }
      [ -f "$ASTERIA_WORKTREE/Dockerfile" ] || { finish FAIL ASTERIA_DOCKERFILE_NOT_FOUND; exit 2; }
      BUILD_LOG="$(mktemp)"
      if ! "$DOCKER_BIN" build --pull=false --label "gace.asteria.exact_sha=$ASTERIA_SHA" -t "$ASTERIA_IMAGE" "$ASTERIA_WORKTREE" >"$BUILD_LOG" 2>&1; then
        BUILD_DETAIL="$(tail -n 12 "$BUILD_LOG" | tr '\n' ';' | head -c 1200)"
        rm -f -- "$BUILD_LOG"
        finish FAIL "ASTERIA_FORENSIC_IMAGE_BUILD_FAILED:$BUILD_DETAIL"
        exit 2
      fi
      rm -f -- "$BUILD_LOG"
      IMG_SHA="$("$DOCKER_BIN" image inspect -f '{{index .Config.Labels "gace.asteria.exact_sha"}}' "$ASTERIA_IMAGE" 2>/dev/null)"
      [ "$IMG_SHA" = "$ASTERIA_SHA" ] || { finish FAIL ASTERIA_FORENSIC_IMAGE_PROVENANCE_MISMATCH; exit 2; }
    fi
    DEBUG_CID="$(cd "$REPO" && "$DOCKER_BIN" compose ps -q debug-ai 2>/dev/null | head -n1)"
    [ -n "$DEBUG_CID" ] || { finish FAIL DEBUGAI_CONTAINER_NOT_FOUND; exit 2; }
    AKEY="$("$DOCKER_BIN" exec "$DEBUG_CID" sh -lc 'printf %s "$AI_CORE_API_KEY"' 2>/dev/null)"
    [ -n "$AKEY" ] || { finish FAIL AI_CORE_KEY_NOT_FOUND; exit 2; }
    TOK="$("$OPENSSL_BIN" rand -hex 32 2>/dev/null)"
    [ -n "$TOK" ] || { unset AKEY; finish FAIL ASTERIA_TOKEN_GENERATION_FAILED; exit 2; }
    export ASTERIA_INTERNAL_TOKEN="$TOK" AI_CORE_API_KEY="$AKEY"
    "$DOCKER_BIN" run -d --name asteria-ab-baseline-forensic --network host -e HOST=127.0.0.1 -e PORT=18111 -e ASTERIA_INTERNAL_TOKEN -e AI_CORE_BASE_URL=http://127.0.0.1:18080 -e AI_CORE_API_KEY -e ASTERIA_TRANSLATION_TIMEOUT_MS=90000 -e ASTERIA_MEMORY_FILE=/tmp/asteria-ab-baseline-forensic-memory.jsonl "$ASTERIA_IMAGE" >/dev/null 2>&1
    CREATE_RC=$?
    unset ASTERIA_INTERNAL_TOKEN AI_CORE_API_KEY TOK AKEY
    [ "$CREATE_RC" -eq 0 ] || { finish FAIL ASTERIA_FORENSIC_CONTAINER_CREATE_FAILED; exit 2; }
    CID="$("$DOCKER_BIN" ps -q -f name=^/asteria-ab-baseline-forensic$ 2>/dev/null | head -n1)"
    [ -n "$CID" ] || { finish FAIL ASTERIA_FORENSIC_CONTAINER_CREATE_NOT_RUNNING; exit 2; }
  fi
fi
TOKEN="$("$DOCKER_BIN" inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CID" 2>/dev/null | sed -n 's/^ASTERIA_INTERNAL_TOKEN=//p' | head -n1)"
[ -n "$TOKEN" ] || { finish FAIL ASTERIA_TOKEN_NOT_FOUND; exit 3; }
health="$("$CURL_BIN" -sS -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 5 http://127.0.0.1:18111/health 2>/dev/null || true)"
[ "$health" = "200" ] || { finish FAIL "ASTERIA_FORENSIC_HEALTH_$health"; exit 4; }
GB="$(read_evt ai-granite)"; QB="$(read_evt ai-qwen3)"
run_case(){ local id="$1" src="$2" body tmp code time_s err out; tmp="$(mktemp)"; body="$("$JQ_BIN" -nc --arg id "$id" --arg src "$src" '{request_id:$id,profile_version:"asteria-translation-v1",target_language:"en",source_language:"ja",segments:[{id:"body",text:$src}]}')"; read -r code time_s < <("$CURL_BIN" -sS --max-time 180 -o "$tmp" -w '%{http_code} %{time_total}' -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary "$body" http://127.0.0.1:18111/internal/v1/translate 2>/dev/null || printf '000 180'); err="$("$JQ_BIN" -r 'if .error then ((.error.code//"UNKNOWN")|tostring)+":"+((.error.message//"")|tostring) else "" end' "$tmp" 2>/dev/null | head -c 300)"; out="$("$JQ_BIN" -r 'if (.segments|type)=="array" then (.segments[0].text//"") else "" end' "$tmp" 2>/dev/null | tr '\n' ' ' | head -c 500)"; rm -f -- "$tmp"; printf '%s|http=%s|seconds=%s|error=%s|output=%s' "$id" "$code" "$time_s" "$err" "$out"; }
C1="$(run_case ja-ab-negation-deadline '2026-10-31まではバックアップを削除してはならない。期限後も、監査が完了するまでは削除しないこと。')"
C6="$(run_case ja-ab-quantity-deadline-bounds '常に最低3台を維持し、5台を超えてはならない。2026-11-15の17:00までに移行を完了すること。')"
GA="$(read_evt ai-granite)"; QA="$(read_evt ai-qwen3)"
finish PASS "" "$C1" "$C6" "$GB" "$GA" "$QB" "$QA"
