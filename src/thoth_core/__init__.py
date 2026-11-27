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
import tomllib
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


def linked_worktree_main_root(root: Path) -> Path | None:
    """If `root` is inside a linked git worktree, return the main checkout path; else None.

    A linked worktree has a `.git` file whose `gitdir:` target contains a `commondir`
    file pointing to the shared `.git` directory. Regular checkouts have a `.git`
    directory and submodules have no `commondir` file, so neither triggers a false positive.
    """
    for candidate in (root, *root.parents):
        dot_git = candidate / ".git"
        if dot_git.is_dir():
            return None
        if dot_git.is_file():
            try:
                lines = dot_git.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                return None
            if not lines:
                return None
            first = lines[0].strip()
            if not first.lower().startswith("gitdir:"):
                return None
            raw_gitdir = first.split(":", 1)[1].strip()
            if not raw_gitdir:
                return None
            gitdir = Path(raw_gitdir)
            gitdir = gitdir.resolve() if gitdir.is_absolute() else (candidate / gitdir).resolve()
            commondir_file = gitdir / "commondir"
            if not commondir_file.is_file():
                return None
            try:
                raw_common = commondir_file.read_text(encoding="utf-8", errors="replace").strip()
            except OSError:
                return None
            if not raw_common:
                return None
            common = Path(raw_common)
            common_dir = common.resolve() if common.is_absolute() else (gitdir / common).resolve()
            return common_dir.parent
    return None


def resolve_root(root_arg: str | None, prog: str, *, allow_worktree: bool = False) -> Path:
    """The instance root is the folder the CLI is launched from (`--root` overrides, mainly for tests)."""
    root = Path(root_arg).expanduser().resolve() if root_arg else Path.cwd().resolve()
    if any((root / marker).exists() for marker in ENGINE_MARKERS):
        fail(
            f"Refusing to use the Thoth engine directory ({root}) as an instance root. "
            f"Run `uv run --project <thoth> {prog} ...` from your instance folder."
        )
    env_allow = os.environ.get("THOTH_ALLOW_WORKTREE", "").strip().lower() in ("1", "true", "yes")
    if not allow_worktree and not env_allow:
        main_root = linked_worktree_main_root(root)
        if main_root is not None:
            fail(
                f"Refusing to run {prog} inside a linked git worktree ({root}); "
                f"instance state lives only on the main checkout ({main_root}) to prevent split-brain logs. "
                f"Run from the main checkout, or pass --allow-worktree / THOTH_ALLOW_WORKTREE=1 if intentional."
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


def paginate(items: list[Any], *, limit: int = 0, offset: int = 0) -> tuple[list[Any], dict[str, Any]]:
    """Slice `items` by `offset` and `limit` (0 = all) and return `(page, pagination_meta)`."""
    if offset < 0:
        fail(f"--offset must be >= 0, got {offset}")
    if limit < 0:
        fail(f"--limit must be >= 0, got {limit}")
    total = len(items)
    page = items[offset : offset + limit] if limit > 0 else items[offset:]
    has_more = offset + len(page) < total
    meta: dict[str, Any] = {
        "count": len(page),
        "total": total,
        "offset": offset,
        "has_more": has_more,
    }
    if limit > 0:
        meta["limit"] = limit
    if has_more:
        meta["next_offset"] = offset + len(page)
    return page, meta


def compile_search_terms(raw_query: str, *, exact: bool = False) -> tuple[bool, list[str], list[re.Pattern[str]]]:
    """Return `(literal_mode, tokens, compiled_patterns)` for keyword or literal search."""
    q = raw_query.strip()
    if not q:
        fail("Search query must not be empty")
    literal = exact or any(ch in q for ch in ("://", "/", ":", "."))
    if literal:
        tok = q.lower()
        return True, [tok], []
    tokens = [t.lower() for t in re.findall(r"[A-Za-z0-9_-]+", q) if t]
    if not tokens:
        fail("Search query must contain at least one searchable term")
    patterns: list[re.Pattern[str]] = []
    for tok in tokens:
        plural = "(?:e?s)?" if len(tok) >= 3 and tok.isalpha() and not tok.endswith("s") else ""
        patterns.append(re.compile(rf"(?<![a-z0-9]){re.escape(tok)}{plural}(?![a-z0-9])"))
    return False, tokens, patterns


def score_search_fields(
    fields: list[tuple[str, int]],
    literal: bool,
    tokens: list[str],
    patterns: list[re.Pattern[str]],
    *,
    all_terms: bool = False,
) -> int:
    """Score weighted `(text, weight)` fields; returns 0 when no match."""
    lowered = [(text.lower(), weight) for text, weight in fields if text]
    matched_tokens = 0
    weighted_score = 0
    for idx, tok in enumerate(tokens):
        tok_matched = False
        pat = None if literal else patterns[idx]
        for text, weight in lowered:
            cnt = text.count(tok) if literal else len(pat.findall(text))  # type: ignore[union-attr]
            if cnt > 0:
                tok_matched = True
                weighted_score += weight + min(cnt - 1, 5)
        if tok_matched:
            matched_tokens += 1
    if matched_tokens == 0 or (all_terms and matched_tokens < len(tokens)):
        return 0
    return matched_tokens * 100 + weighted_score


THOTH_CONFIG_FILE = "thoth.toml"
TELEMETRY_DIR = ".thoth-telemetry"


def load_thoth_toml(root: Path) -> tuple[dict[str, Any] | None, str | None]:
    """Load `<root>/thoth.toml` if present. Returns `(data_or_none, error_or_none)`."""
    cfg_path = root / THOTH_CONFIG_FILE
    if not cfg_path.exists():
        return None, None
    try:
        return tomllib.loads(cfg_path.read_text(encoding="utf-8")), None
    except (OSError, tomllib.TOMLDecodeError) as e:
        return None, f"Failed to parse {THOTH_CONFIG_FILE}: {e}"


def append_telemetry(root: Path, filename: str, event: dict[str, Any]) -> None:
    """Append one compact JSONL telemetry event under `<root>/.thoth-telemetry/<filename>`."""
    log_path = root / TELEMETRY_DIR / filename
    line = json.dumps(event, ensure_ascii=False) + "\n"
    with write_lock(log_path.parent):
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(line)
