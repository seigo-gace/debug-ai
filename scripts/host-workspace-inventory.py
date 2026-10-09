#!/usr/bin/env python3
"""Read-only, paginated inventory for the existing bounded DebugAI Host command.

Lists top-level directories in the two established developer workspaces.
Does not modify, open, or copy repository files.
"""
from __future__ import annotations
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOTS = (Path("/home/admin1/projects"), Path("/home/admin1/worktrees"))
PER_PAGE = 6
MAX_BYTES = 4096


def git(path: Path, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(path), *args],
            capture_output=True, text=True, timeout=2, check=False,
            env={**os.environ, "GIT_OPTIONAL_LOCKS": "0",
                 "GIT_TERMINAL_PROMPT": "0"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return result.stdout.strip() if result.returncode == 0 else ""


def record(root: Path, item: Path) -> dict:
    marker = item / ".git"
    kind = "directory"
    data = {"root": str(root), "name": item.name[:120],
            "path": str(item)[:240], "kind": kind}
    if marker.is_file():
        data["kind"] = "worktree_or_linked_git"
    elif marker.is_dir():
        data["kind"] = "git_repository"
    if marker.is_file() or marker.is_dir():
        head = git(item, "rev-parse", "--verify", "HEAD")
        if re.fullmatch(r"[a-f0-9]{40}", head):
            data["head"] = head[:12]
            branch = git(item, "symbolic-ref", "--quiet", "--short", "HEAD")
            data["branch"] = branch[:96] if branch else "DETACHED"
            common = git(item, "rev-parse", "--path-format=absolute",
                         "--git-common-dir")
            if common:
                data["git_common_dir"] = common[:200]
            log = git(item, "log", "-1", "--format=%cI %s")
            if log:
                data["last_commit"] = log[:160]
        else:
            data["git_state"] = "UNREADABLE"
    return data


def inventory(page: int = 0, roots: tuple[Path, ...] = ROOTS) -> dict:
    if not isinstance(page, int) or not 0 <= page <= 9999:
        raise ValueError("INVALID_PAGE")
    items = []
    missing = []
    for root in roots:
        if not root.is_dir():
            missing.append(str(root))
            continue
        try:
            entries = sorted(root.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            missing.append(str(root))
            continue
        for item in entries:
            if item.is_symlink():
                # Name only; never follow a symlink out of the workspace.
                items.append({"root": str(root), "name": item.name[:120],
                              "kind": "symlink", "path": str(item)[:240]})
            elif item.is_dir():
                items.append(record(root, item))
    total = len(items)
    start = page * PER_PAGE
    selected = items[start:start + PER_PAGE]
    result = {"schema": "debugai.host-workspace-inventory/v1", "page": page,
              "page_size": PER_PAGE, "total": total,
              "next_page": page + 1 if start + PER_PAGE < total else None,
              "missing_roots": missing, "entries": selected}
    serialized = json.dumps(result, separators=(",", ":"), ensure_ascii=True)
    if len(serialized.encode("utf-8")) > MAX_BYTES:
        raise ValueError("INVENTORY_OUTPUT_EXCEEDS_EXISTING_HOST_LIMIT")
    return result


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2 or not re.fullmatch(r"(?:0|[1-9][0-9]{0,3})", sys.argv[1]):
            raise ValueError("INVALID_PAGE")
        print(json.dumps(inventory(int(sys.argv[1])), separators=(",", ":")))
    except (ValueError, OSError) as exc:
        print("HOST_WORKSPACE_INVENTORY_ERROR=" + str(exc), file=sys.stderr)
        sys.exit(2)
