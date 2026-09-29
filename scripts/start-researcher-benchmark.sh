#!/bin/sh
set -eu

usage() {
  echo "usage: $0 [--resume RUN_DIR]" >&2
  exit 2
}

repo_root=$(git rev-parse --show-toplevel)
container=${DEBUG_AI_BENCHMARK_CONTAINER:-debug-ai-debug-ai-1}
workspace_host=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Source}}{{end}}{{end}}' "$container")
test -n "$workspace_host" || { echo "WORKSPACE_MOUNT_NOT_FOUND" >&2; exit 1; }
run_root=${DEBUG_AI_BENCHMARK_RUN_ROOT:-"$repo_root/artifacts/benchmark-runs"}

if test "$#" -eq 0; then
  exact_sha=$(git -C "$repo_root" rev-parse HEAD)
  branch=$(git -C "$repo_root" branch --show-current)
  test -n "$branch" || { echo "BENCHMARK_BRANCH_REQUIRED" >&2; exit 1; }
  git -C "$repo_root" cat-file -e "$exact_sha:server/control/durable-researcher-benchmark.js"
  run_id="researcher-skill-effect-$(date -u +%Y%m%dT%H%M%SZ)-$(printf '%s' "$exact_sha" | cut -c1-12)"
  run_dir="$run_root/$run_id"
  source_dir="$run_dir/source"
  mkdir -p "$run_dir"
  git -C "$repo_root" worktree add --detach "$source_dir" "$exact_sha" >/dev/null
elif test "$#" -eq 2 && test "$1" = "--resume"; then
  run_dir=$(realpath "$2")
  source_dir="$run_dir/source"
  test -d "$source_dir" || { echo "BENCHMARK_SOURCE_NOT_FOUND" >&2; exit 1; }
  test -f "$run_dir/metadata.json" || { echo "BENCHMARK_METADATA_NOT_FOUND" >&2; exit 1; }
  exact_sha=$(git -C "$source_dir" rev-parse HEAD)
  branch=$(sed -n 's/^  "branch": "\([^"]*\)",$/\1/p' "$run_dir/metadata.json")
  test -n "$branch" || { echo "BENCHMARK_BRANCH_REQUIRED" >&2; exit 1; }
else
  usage
fi

run_dir=$(realpath "$run_dir")
source_dir=$(realpath "$source_dir")
case "$source_dir" in "$workspace_host"/*) ;; *) echo "BENCHMARK_SOURCE_OUTSIDE_WORKSPACE_MOUNT" >&2; exit 1;; esac
container_source="/workspace/$(realpath --relative-to="$workspace_host" "$source_dir")"
container_run_dir="/workspace/$(realpath --relative-to="$workspace_host" "$run_dir")"

docker exec -d \
  -w "$container_source" \
  -e NODE_PATH=/app/node_modules \
  -e DEBUG_AI_BENCHMARK_GIT_SHA="$exact_sha" \
  -e DEBUG_AI_BENCHMARK_BRANCH="$branch" \
  -e DEBUG_AI_BENCHMARK_RUN_DIR="$container_run_dir" \
  "$container" sh -c 'exec node server/control/durable-researcher-benchmark.js --run-dir "$DEBUG_AI_BENCHMARK_RUN_DIR" >>"$DEBUG_AI_BENCHMARK_RUN_DIR/process.log" 2>&1'

echo "BENCHMARK_ID=researcher-skill-effect-v1"
echo "EXACT_GIT_SHA=$exact_sha"
echo "BRANCH=$branch"
echo "RUN_DIR=$run_dir"
echo "STATE_FILE=$run_dir/state.json"
echo "CHECKPOINT_FILE=$run_dir/checkpoints.jsonl"
echo "LOG_FILE=$run_dir/process.log"
