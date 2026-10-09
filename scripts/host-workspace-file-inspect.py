#!/usr/bin/env python3
"""Bounded read-only inspect for one regular file under a registered workspace entry."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOTS = (Path("/home/admin1/projects"), Path("/home/admin1/worktrees"))
MAX_BYTES = 4096
PREVIEW_MAX_BYTES = 512
ENTRY_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,120}$")
REL_PATH_RE = re.compile(r"^[A-Za-z0-9_./-]{1,180}$")
SECRET_LINE_PATTERNS = (
    re.compile(
        r"(?i)(api[_-]?key|secret|token|password|authorization|bearer)\s*[:=]\s*\S+"
    ),
    re.compile(r"(?i)(aws[_-]?secret[_-]?access[_-]?key|private[_-]?key)\s*[:=]\s*\S+"),
    re.compile(r"-----BEGIN [A-Z ]+ PRIVATE KEY-----"),
)


def workspace_roots() -> tuple[Path, ...]:
    raw = os.environ.get("DEBUG_AI_HOST_WORKSPACE_ROOTS", "").strip()
    if not raw:
        return ROOTS
    roots: list[Path] = []
    for part in raw.split(":"):
        part = part.strip()
        if part:
            roots.append(Path(part).resolve())
    if not roots:
        raise ValueError("WORKSPACE_ROOTS_INVALID")
    return tuple(roots)


def deny_path_part(part: str) -> bool:
    lower = part.lower()
    if part in (".env", ".git", ".debugai-input"):
        return True
    if lower.endswith(".pem") or lower.endswith(".key"):
        return True
    for needle in ("credentials", "id_rsa", "token", "secret", "private_key"):
        if needle in lower:
            return True
    return False


def validate_relative_path(rel: str) -> list[str]:
    if not rel or rel == "." or not REL_PATH_RE.fullmatch(rel):
        raise ValueError("RELATIVE_PATH_INVALID")
    parts = rel.replace("\\", "/").split("/")
    if ".." in parts:
        raise ValueError("RELATIVE_PATH_INVALID")
    for part in parts:
        if part in ("", "."):
            continue
        if deny_path_part(part):
            raise ValueError("PATH_FORBIDDEN")
    return [p for p in parts if p and p != "."]


def resolve_entry(entry_name: str, roots: tuple[Path, ...]) -> tuple[Path, Path]:
    if not ENTRY_NAME_RE.fullmatch(entry_name):
        raise ValueError("ENTRY_NAME_INVALID")
    matches: list[tuple[Path, Path]] = []
    for root in roots:
        if not root.is_dir():
            continue
        candidate = root / entry_name
        try:
            if candidate.is_symlink():
                raise ValueError("ENTRY_IS_SYMLINK")
        except OSError as exc:
            raise ValueError("ENTRY_UNREADABLE") from exc
        if candidate.is_dir():
            matches.append((root, candidate))
    if not matches:
        raise ValueError("ENTRY_NOT_FOUND")
    if len(matches) > 1:
        raise ValueError("ENTRY_AMBIGUOUS")
    return matches[0]


def path_within_root(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def resolve_file(entry_root: Path, parts: list[str], roots: tuple[Path, ...]) -> Path:
    current = entry_root
    for part in parts:
        current = current / part
        try:
            if current.is_symlink():
                raise ValueError("SYMLINK_IN_PATH")
        except OSError as exc:
            raise ValueError("PATH_UNREADABLE") from exc
    try:
        mode = current.lstat().st_mode
        if not stat.S_ISREG(mode):
            raise ValueError("NOT_A_REGULAR_FILE")
        resolved = current.resolve()
    except OSError as exc:
        raise ValueError("PATH_UNREADABLE") from exc
    if not path_within_root(resolved, entry_root):
        raise ValueError("PATH_ESCAPE_ENTRY")
    if not any(path_within_root(resolved, root) for root in roots):
        raise ValueError("PATH_ESCAPE_ROOT")
    return resolved


def redact_preview(text: str) -> str:
    out = text
    for pattern in SECRET_LINE_PATTERNS:
        out = pattern.sub("[REDACTED]", out)
    return out


def content_preview(path: Path) -> str:
    with path.open("rb") as handle:
        raw = handle.read(PREVIEW_MAX_BYTES)
    text = raw.decode("utf-8", errors="replace")
    return redact_preview(text)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def inspect_file(entry_name: str, relative_path: str, roots: tuple[Path, ...] | None = None) -> dict:
    roots = roots or workspace_roots()
    parts = validate_relative_path(relative_path)
    _root, entry_root = resolve_entry(entry_name, roots)
    file_path = resolve_file(entry_root, parts, roots)
    stat = file_path.stat()
    preview = content_preview(file_path)
    result = {
        "schema": "debugai.host-workspace-file-inspect/v1",
        "entry_name": entry_name,
        "relative_path": relative_path.replace("\\", "/"),
        "path": str(file_path)[:240],
        "size": stat.st_size,
        "mtime_iso": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "sha256": sha256_file(file_path),
        "content_preview": preview,
    }
    serialized = json.dumps(result, separators=(",", ":"), ensure_ascii=True)
    if len(serialized.encode("utf-8")) > MAX_BYTES:
        trimmed = preview
        while trimmed:
            trimmed = trimmed[:-32]
            result["content_preview"] = trimmed
            serialized = json.dumps(result, separators=(",", ":"), ensure_ascii=True)
            if len(serialized.encode("utf-8")) <= MAX_BYTES:
                break
        else:
            result["content_preview"] = ""
            serialized = json.dumps(result, separators=(",", ":"), ensure_ascii=True)
        if len(serialized.encode("utf-8")) > MAX_BYTES:
            raise ValueError("INSPECT_OUTPUT_EXCEEDS_HOST_LIMIT")
    return result


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("ARGUMENTS_INVALID")
        print(
            json.dumps(
                inspect_file(sys.argv[1], sys.argv[2]),
                separators=(",", ":"),
                ensure_ascii=True,
            )
        )
    except (ValueError, OSError) as exc:
        print("HOST_WORKSPACE_FILE_INSPECT_ERROR=" + str(exc), file=sys.stderr)
        sys.exit(2)
