#!/usr/bin/env bash
set -uo pipefail

EXPECTED_HEAD="${DEBUG_AI_EXPECTED_HEAD:-}"
EXPECTED_BRANCH="${DEBUG_AI_EXPECTED_BRANCH:-migration/server-canonical-20260925}"
TARGET_DIR="${DEBUG_AI_TARGET_DIR:-/srv/debug-ai}"
PORTS=(18080 18081 18082 18083 18084 3000 7374 7376 8787)

echo "========== DEBUGAI CONTABO READ-ONLY PREFLIGHT =========="
echo "TIMESTAMP_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "HOST=$(hostname)"
echo "USER=$(id -un)"
echo "EXPECTED_BRANCH=${EXPECTED_BRANCH}"
echo "EXPECTED_HEAD=${EXPECTED_HEAD:-NOT_SUPPLIED}"
echo

echo "===== HOST ====="
uname -a || true
free -h || true
df -h / /srv 2>/dev/null || df -h / || true
echo

if docker ps >/dev/null 2>&1; then
  D=(docker)
elif sudo -n docker ps >/dev/null 2>&1; then
  D=(sudo docker)
else
  echo "DOCKER_ACCESS=BLOCKED"
  D=()
fi

if ((${#D[@]})); then
  echo "===== DOCKER ====="
  "${D[@]}" version --format 'DockerServer={{.Server.Version}}' 2>/dev/null || true
  "${D[@]}" compose version 2>/dev/null || true
  "${D[@]}" ps --format 'NAME={{.Names}} IMAGE={{.Image}} STATUS={{.Status}} PORTS={{.Ports}}' || true
  echo
  echo "===== COMPOSE AUTHORITY (NO ENV VALUES) ====="
  while IFS= read -r cid; do
    [ -n "$cid" ] || continue
    "${D[@]}" inspect "$cid" --format 'NAME={{.Name}} PROJECT={{index .Config.Labels "com.docker.compose.project"}} SERVICE={{index .Config.Labels "com.docker.compose.service"}} WORKDIR={{index .Config.Labels "com.docker.compose.project.working_dir"}} CONFIG={{index .Config.Labels "com.docker.compose.project.config_files"}}' 2>/dev/null || true
  done < <("${D[@]}" ps -q)
else
  echo "DOCKER=UNAVAILABLE"
fi
echo

echo "===== LISTEN PORTS ====="
if command -v ss >/dev/null 2>&1; then
  for p in "${PORTS[@]}"; do
    if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${p}$"; then echo "PORT_${p}=LISTEN"; else echo "PORT_${p}=CLOSED"; fi
  done
else
  echo "SS=UNAVAILABLE"
fi
echo

echo "===== SAFE HTTP PROBES ====="
probe_http(){ local name="$1" url="$2"; local code; code=$(curl -sS --max-time 3 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true); [ -n "$code" ] || code=000; echo "${name}=${code}"; }
if command -v curl >/dev/null 2>&1; then
  probe_http AI_CORE_HTTP http://127.0.0.1:18080/
  probe_http TGSERVER_HEALTH_HTTP http://127.0.0.1:3000/health
  probe_http EVIDENCE_SEARCH_HEALTH_HTTP http://127.0.0.1:7376/health
  probe_http EVALUATOR_HEALTH_HTTP http://127.0.0.1:7374/health
  probe_http DEBUG_AI_HEALTH_HTTP http://127.0.0.1:8787/health
else
  echo "CURL=UNAVAILABLE"
fi
echo

echo "===== TARGET REPOSITORY ====="
if [ -d "$TARGET_DIR/.git" ]; then
  current_branch=$(git -C "$TARGET_DIR" branch --show-current 2>/dev/null || true)
  current_head=$(git -C "$TARGET_DIR" rev-parse HEAD 2>/dev/null || true)
  echo "DEBUG_AI_TARGET_REPO=EXISTS"
  echo "DEBUG_AI_BRANCH=${current_branch}"
  echo "DEBUG_AI_HEAD=${current_head}"
  if [ "$current_branch" = "$EXPECTED_BRANCH" ]; then echo "DEBUG_AI_EXPECTED_BRANCH=YES"; else echo "DEBUG_AI_EXPECTED_BRANCH=NO"; fi
  if [ -n "$EXPECTED_HEAD" ]; then
    if [ "$current_head" = "$EXPECTED_HEAD" ]; then echo "DEBUG_AI_EXPECTED_HEAD=YES"; else echo "DEBUG_AI_EXPECTED_HEAD=NO"; fi
  else
    echo "DEBUG_AI_EXPECTED_HEAD=NOT_CHECKED"
  fi
  if [ -n "$(git -C "$TARGET_DIR" status --porcelain 2>/dev/null || true)" ]; then echo "DEBUG_AI_WORKTREE=CLEAN_NO"; else echo "DEBUG_AI_WORKTREE=CLEAN_YES"; fi
else
  echo "DEBUG_AI_TARGET_REPO=MISSING_PREDEPLOY_OK"
fi
echo

echo "===== TGSERVER P004 DISCOVERY ====="
P004_STATE="REGISTRY_NOT_FOUND"
if ((${#D[@]})); then
  while IFS= read -r cid; do
    [ -n "$cid" ] || continue
    name=$("${D[@]}" inspect "$cid" --format '{{.Name}}' 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
    svc=$("${D[@]}" inspect "$cid" --format '{{index .Config.Labels "com.docker.compose.service"}}' 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
    case "$name $svc" in *tgserver*|*tgs*)
      wd=$("${D[@]}" inspect "$cid" --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' 2>/dev/null || true)
      if [ -n "$wd" ] && [ -f "$wd/storage-registry.json" ]; then
        if grep -q '"P004"' "$wd/storage-registry.json"; then P004_STATE="FOUND"; else P004_STATE="NOT_FOUND"; fi
        break
      fi
    esac
  done < <("${D[@]}" ps -q)
fi
echo "TGSERVER_P004=${P004_STATE}"
echo

echo "===== EXISTING DEBUGAI SECRET PATH METADATA ONLY ====="
ENV_FILE="$TARGET_DIR/.env"
for key in DEBUG_AI_EVIDENCE_SEARCH_SHARED_KEY_HOST_PATH DEBUG_AI_EVALUATOR_API_KEY_HOST_PATH; do
  if [ -f "$ENV_FILE" ]; then
    value=$(grep -m1 -E "^${key}=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
    if [ -n "$value" ] && [ -f "$value" ]; then
      mode=$(stat -c '%a' "$value" 2>/dev/null || echo unknown); bytes=$(stat -c '%s' "$value" 2>/dev/null || echo unknown)
      echo "${key}=FILE_PRESENT MODE=${mode} BYTES=${bytes}"
    elif [ -n "$value" ]; then
      echo "${key}=FILE_MISSING"
    else
      echo "${key}=UNSET"
    fi
  else
    echo "${key}=ENV_NOT_DEPLOYED"
  fi
done

echo
echo "PREFLIGHT_MUTATIONS=0"
echo "========== END PREFLIGHT =========="
