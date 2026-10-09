#!/usr/bin/env python3
"""Bounded paged read-only inspect for one regular file under a registered workspace entry."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_ROOTS = (Path("/home/admin1/projects"), Path("/home/admin1/worktrees"))
MAX_JSON_BYTES = 4096
CHUNK_MAX_BYTES = 512
SHA256_MAX_BYTES = 2 * 1024 * 1024
READ_BLOCK = 256 * 1024
ENTRY_NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,120}$")
REL_PATH_RE = re.compile(r"^[A-Za-z0-9_./-]{1,180}$")
OFFSET_RE = re.compile(r"^(0|[1-9][0-9]{0,5})$")
ROOT_KEY_RE = re.compile(r"^(projects|worktrees)$")
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
        return DEFAULT_ROOTS
    roots: list[Path] = []
    for part in raw.split(":"):
        part = part.strip()
        if part:
            roots.append(Path(part).resolve())
    if not roots:
        raise ValueError("WORKSPACE_ROOTS_INVALID")
    return tuple(roots)


def registry_path() -> Path:
    override = os.environ.get("DEBUG_AI_HOST_ADMITTED_ENTRIES", "").strip()
    if override:
        return Path(override).resolve()
    repo = os.environ.get("DEBUG_AI_HOST_REPO", "/home/admin1/projects/debug-ai")
    return Path(repo).resolve() / "operations" / "host-admitted-workspace-entries.json"


def load_registry() -> dict:
    path = registry_path()
    try:
        raw = path.read_text(encoding="utf-8")
        doc = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("REGISTRY_UNREADABLE") from exc
    if doc.get("schema") != "debugai.host-admitted-workspace-entries/v1":
        raise ValueError("REGISTRY_SCHEMA_INVALID")
    entries = doc.get("entries")
    if not isinstance(entries, dict):
        raise ValueError("REGISTRY_ENTRIES_INVALID")
    return entries


def root_for_key(key: str, roots: tuple[Path, ...]) -> Path:
    if not ROOT_KEY_RE.fullmatch(key):
        raise ValueError("ROOT_KEY_INVALID")
    if len(roots) == 1:
        return roots[0]
    named = {r.name: r for r in roots}
    if key in named:
        return named[key]
    if key == "projects" and len(roots) >= 1:
        return roots[0]
    if key == "worktrees" and len(roots) >= 2:
        return roots[1]
    raise ValueError("ROOT_KEY_UNAVAILABLE")


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


def parse_content_offset(raw: str) -> int:
    if not OFFSET_RE.fullmatch(raw):
        raise ValueError("CONTENT_OFFSET_INVALID")
    value = int(raw, 10)
    if value < 0 or value > 999999:
        raise ValueError("CONTENT_OFFSET_INVALID")
    return value


def resolve_registered_entry(
    entry_name: str,
    roots: tuple[Path, ...],
    root_key_hint: str | None,
) -> tuple[Path, Path]:
    if not ENTRY_NAME_RE.fullmatch(entry_name):
        raise ValueError("ENTRY_NAME_INVALID")
    entries = load_registry()
    meta = entries.get(entry_name)
    if not isinstance(meta, dict):
        raise ValueError("ENTRY_NOT_REGISTERED")
    reg_key = str(meta.get("root_key") or "")
    if not ROOT_KEY_RE.fullmatch(reg_key):
        raise ValueError("ENTRY_REGISTRY_INVALID")
    if root_key_hint is not None and root_key_hint != reg_key:
        raise ValueError("ENTRY_ROOT_KEY_MISMATCH")
    root = root_for_key(reg_key, roots)
    if not root.is_dir():
        raise ValueError("ENTRY_ROOT_MISSING")
    candidate = root / entry_name
    try:
        if candidate.is_symlink():
            raise ValueError("ENTRY_IS_SYMLINK")
    except OSError as exc:
        raise ValueError("ENTRY_UNREADABLE") from exc
    if not candidate.is_dir():
        raise ValueError("ENTRY_NOT_FOUND")
    return root, candidate


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


def redact_chunk(text: str) -> str:
    out = text
    for pattern in SECRET_LINE_PATTERNS:
        out = pattern.sub("[REDACTED]", out)
    return out


def sha256_file(path: Path, max_bytes: int) -> str:
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(READ_BLOCK)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise ValueError("FILE_TOO_LARGE")
            digest.update(chunk)
    return digest.hexdigest()


def read_content_page(path: Path, offset: int, file_size: int) -> tuple[str, int]:
    if offset > file_size:
        raise ValueError("CONTENT_OFFSET_OUT_OF_RANGE")
    with path.open("rb") as handle:
        handle.seek(offset)
        raw = handle.read(CHUNK_MAX_BYTES)
    text = raw.decode("utf-8", errors="replace")
    return redact_chunk(text), len(raw)


def trim_result(result: dict) -> dict:
    serialized = json.dumps(result, separators=(",", ":"), ensure_ascii=True)
    if len(serialized.encode("utf-8")) <= MAX_JSON_BYTES:
        return result
    chunk = str(result.get("content_chunk") or "")
    while chunk:
        chunk = chunk[:-32]
        result["content_chunk"] = chunk
        result["content_length"] = len(chunk.encode("utf-8"))
        serialized = json.dumps(result, separators=(",", ":"), ensure_ascii=True)
        if len(serialized.encode("utf-8")) <= MAX_JSON_BYTES:
            return result
    result["content_chunk"] = ""
    result["content_length"] = 0
    serialized = json.dumps(result, separators=(",", ":"), ensure_ascii=True)
    if len(serialized.encode("utf-8")) > MAX_JSON_BYTES:
        raise ValueError("INSPECT_OUTPUT_EXCEEDS_HOST_LIMIT")
    return result


def inspect_file(
    entry_name: str,
    relative_path: str,
    content_offset: int = 0,
    root_key: str | None = None,
    roots: tuple[Path, ...] | None = None,
) -> dict:
    roots = roots or workspace_roots()
    parts = validate_relative_path(relative_path)
    _root, entry_root = resolve_registered_entry(entry_name, roots, root_key)
    file_path = resolve_file(entry_root, parts, roots)
    st = file_path.stat()
    file_size = st.st_size
    mtime_iso = datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()
    if file_size > SHA256_MAX_BYTES:
        raise ValueError("FILE_TOO_LARGE")
    digest = sha256_file(file_path, SHA256_MAX_BYTES)
    chunk, content_length = read_content_page(file_path, content_offset, file_size)
    next_offset = content_offset + content_length
    if next_offset >= file_size:
        next_offset_val = None
        complete = True
    else:
        next_offset_val = next_offset
        complete = False
    identity = {"size": file_size, "mtime_iso": mtime_iso, "sha256": digest}
    result = {
        "schema": "debugai.host-workspace-file-inspect/v1",
        "entry_name": entry_name,
        "relative_path": relative_path.replace("\\", "/"),
        "file_size": file_size,
        "mtime_iso": mtime_iso,
        "sha256": digest,
        "file_identity": identity,
        "content_offset": content_offset,
        "content_length": content_length,
        "content_chunk": chunk,
        "next_offset": next_offset_val,
        "complete": complete,
    }
    return trim_result(result)


def parse_cli(argv: list[str]) -> tuple[str, str, int, str | None]:
    if len(argv) < 3 or len(argv) > 5:
        raise ValueError("ARGUMENTS_INVALID")
    entry_name = argv[1]
    relative_path = argv[2]
    content_offset = 0
    root_key = None
    if len(argv) >= 4:
        content_offset = parse_content_offset(argv[3])
    if len(argv) >= 5:
        root_key = argv[4]
        if not ROOT_KEY_RE.fullmatch(root_key):
            raise ValueError("ROOT_KEY_INVALID")
    return entry_name, relative_path, content_offset, root_key


if __name__ == "__main__":
    try:
        entry, rel, offset, rk = parse_cli(sys.argv)
        print(
            json.dumps(
                inspect_file(entry, rel, offset, rk),
                separators=(",", ":"),
                ensure_ascii=True,
            )
        )
    except (ValueError, OSError) as exc:
        print("HOST_WORKSPACE_FILE_INSPECT_ERROR=" + str(exc), file=sys.stderr)
        sys.exit(2)
