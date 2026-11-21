"""Shared stdlib-only helpers for Thoth CLIs (thoth-mem, todo-list).

- JSON error output and strict `--json` key validation
- Secret scanning before anything is written
- Instance root = launch folder; refuses the Thoth engine directory
- OS file lock (`fcntl.flock` on Unix, `msvcrt.locking` on Windows)
- Atomic writes (`tmp` -> `fsync` -> `os.replace`)
- Flat YAML frontmatter (scalars + inline JSON lists) render/parse helpers
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import secrets
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

try:
    import fcntl
except ImportError:
    fcntl = None
    try:
        import msvcrt
    except ImportError:
        msvcrt = None
else:
    msvcrt = None


SECRET_PATTERNS = (
    ("private key", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("API key", re.compile(r"\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{20,}\b")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
)

# Files whose presence marks a directory as the Thoth engine checkout itself.
ENGINE_MARKERS = (
    Path("src") / "thoth_core" / "__init__.py",
    Path("src") / "thoth_mem" / "cli.py",
)


def now_local() -> datetime:
    tz_name = os.environ.get("THOTH_TZ")
    if tz_name:
        try:
            return datetime.now(ZoneInfo(tz_name)).replace(microsecond=0)
        except ZoneInfoNotFoundError:
            fail(f"Unknown time zone THOTH_TZ={tz_name!r}; unset it or install tzdata")
    return datetime.now().astimezone().replace(microsecond=0)


def fail(msg: str, code: int = 1) -> None:
    print(json.dumps({"ok": False, "error": msg}, ensure_ascii=False), file=sys.stderr)
    sys.exit(code)


def check_secrets(text: str, field: str) -> None:
    if not text:
        return
    for kind, pat in SECRET_PATTERNS:
        if pat.search(text):
            fail(f"{field} appears to contain a {kind}; redact secrets before saving")


def validate_json_keys(payload: Any, allowed: frozenset[str], cmd: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        fail(f"{cmd} --json expects a JSON object")
    unknown = sorted(set(payload.keys()) - allowed)
    if unknown:
        fail(f"Unknown JSON key(s) for {cmd}: {', '.join(unknown)}. Allowed keys: {', '.join(sorted(allowed))}")
    return payload


def read_json_stdin(allowed: frozenset[str], cmd: str) -> dict[str, Any]:
    raw = sys.stdin.read()
    try:
        return validate_json_keys(json.loads(raw), allowed, cmd)
    except json.JSONDecodeError as e:
        fail(f"Invalid JSON on stdin: {e}")
        raise


def resolve_root(root_arg: str | None, prog: str) -> Path:
    """The instance root is the folder the CLI is launched from (`--root` overrides, mainly for tests)."""
    root = Path(root_arg).expanduser().resolve() if root_arg else Path.cwd().resolve()
    if any((root / marker).exists() for marker in ENGINE_MARKERS):
        fail(
            f"Refusing to use the Thoth engine directory ({root}) as an instance root. "
            f"Run `uv run --project <thoth> {prog} ...` from your instance folder."
        )
    return root


@contextlib.contextmanager
def write_lock(lock_dir: Path):
    lock_dir.mkdir(parents=True, exist_ok=True)
    fh = open(lock_dir / ".write.lock", "a+")
    try:
        if fcntl is not None:
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
        elif msvcrt is not None:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)
        yield
    finally:
        try:
            if fcntl is not None:
                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)
            elif msvcrt is not None:
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
        finally:
            fh.close()


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / f".{path.name}.{os.getpid()}.{secrets.token_hex(3)}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except Exception:
        with contextlib.suppress(OSError):
            tmp.unlink()
        raise


def yaml_scalar(val: str) -> str:
    if not val or any(ch in val for ch in ':#"\'\n\r\t{}[]&*!|>-') or val != val.strip():
        return json.dumps(val, ensure_ascii=False)
    return val


def parse_yaml_value(raw: str) -> Any:
    raw = raw.strip()
    if not raw:
        return ""
    if raw[0] in ('"', "[", "{"):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            pass
    if raw.startswith("'") and raw.endswith("'") and len(raw) >= 2:
        return raw[1:-1]
    return raw


def split_frontmatter(text: str, path: Path) -> tuple[list[str], str]:
    """Return (frontmatter lines, body) for a `---` delimited Markdown file."""
    if not text.startswith("---\n"):
        raise ValueError(f"Missing frontmatter in {path}")
    end = text.find("\n---\n", 4)
    if end == -1:
        end = text.find("\n---", 4)
        if end == -1:
            raise ValueError(f"Unterminated frontmatter in {path}")
        body = text[end + 4 :].lstrip("\n")
    else:
        body = text[end + 5 :].lstrip("\n")
    return text[4:end].splitlines(), body


def normalize_list(val: Any) -> list[str]:
    if not val:
        return []
    if isinstance(val, list):
        return [str(x).strip() for x in val if str(x).strip()]
    return [x.strip() for x in str(val).split(",") if x.strip()]
