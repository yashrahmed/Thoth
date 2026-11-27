"""CLI for safe, path-scoped local commits of instance state (`auto-commit`).

Subcommands:
- `run`      — validate paths against allowed state prefixes, check git preconditions
               (work tree, no merge/rebase, gitignore, actual diff), stage and commit ONLY
               the specified paths locally (never pushes, never touches unrelated files),
               and log telemetry to `<root>/.thoth-telemetry/auto-commit.jsonl`.
- `validate` — validate `[auto_commit]` in `thoth.toml` (if present) and report git readiness.
- `stats`    — summarize recent commits, skips, and failures from telemetry.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from thoth_core import (
    TELEMETRY_DIR,
    THOTH_CONFIG_FILE,
    append_telemetry,
    check_secrets,
    fail,
    load_thoth_toml,
    now_local,
    resolve_root,
)

TELEMETRY_FILE = "auto-commit.jsonl"
DEFAULT_ALLOWED_PREFIXES = ("memory/episodes/", "tasks/", "health/", "work-artifacts/")
ALLOWED_SECTION_KEYS = frozenset({"paths"})
IN_PROGRESS_MARKERS = (
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "BISECT_LOG",
)


def _normalize_prefix(raw: str) -> str:
    p = raw.strip().replace("\\", "/").lstrip("./")
    if not p or ".." in Path(p).parts:
        raise ValueError(f"Invalid allowed prefix {raw!r}")
    return p if p.endswith("/") else f"{p}/"


def load_auto_commit_config(root: Path) -> tuple[list[str], list[str]]:
    """Return `(allowed_prefixes, errors)` from optional `[auto_commit]` in `thoth.toml`."""
    raw, parse_err = load_thoth_toml(root)
    if parse_err:
        return [], [parse_err]
    if raw is None or "auto_commit" not in raw:
        return list(DEFAULT_ALLOWED_PREFIXES), []

    sec = raw["auto_commit"]
    if not isinstance(sec, dict):
        return [], ["[auto_commit] must be a table"]

    errors: list[str] = []
    unknown = sorted(set(sec.keys()) - ALLOWED_SECTION_KEYS)
    if unknown:
        errors.append(f"[auto_commit] has unknown key(s): {', '.join(unknown)}")

    if "paths" not in sec:
        return list(DEFAULT_ALLOWED_PREFIXES), errors

    raw_paths = sec["paths"]
    if not isinstance(raw_paths, list) or not raw_paths or not all(isinstance(x, str) and x.strip() for x in raw_paths):
        errors.append("[auto_commit].paths must be a non-empty list of strings")
        return [], errors

    prefixes: list[str] = []
    for p in raw_paths:
        try:
            prefixes.append(_normalize_prefix(p))
        except ValueError as e:
            errors.append(str(e))
    return prefixes, errors


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=str(root),
        text=True,
        capture_output=True,
        check=False,
    )


def _check_git_ready(root: Path) -> tuple[bool, str | None]:
    inside = _git(root, "rev-parse", "--is-inside-work-tree")
    if inside.returncode != 0 or inside.stdout.strip() != "true":
        return False, "not_git_repo"

    git_dir_proc = _git(root, "rev-parse", "--git-dir")
    if git_dir_proc.returncode != 0:
        return False, "not_git_repo"
    git_dir = Path(git_dir_proc.stdout.strip())
    if not git_dir.is_absolute():
        git_dir = (root / git_dir).resolve()

    for marker in IN_PROGRESS_MARKERS:
        if (git_dir / marker).exists():
            return False, f"git_op_in_progress:{marker}"
    return True, None


def _normalize_input_path(root: Path, raw_path: str, allowed_prefixes: list[str]) -> str:
    p = Path(raw_path)
    if p.is_absolute():
        try:
            rel = p.resolve().relative_to(root.resolve())
        except ValueError:
            fail(f"Path {raw_path!r} is outside the instance root ({root})")
            raise
    else:
        resolved = (root / p).resolve()
        try:
            rel = resolved.relative_to(root.resolve())
        except ValueError:
            fail(f"Path {raw_path!r} escapes the instance root ({root})")
            raise

    rel_posix = rel.as_posix()
    if not rel_posix or rel_posix == ".":
        fail("Refusing to commit the instance root '.' — pass explicit state paths")

    allowed = any(
        rel_posix == pref.rstrip("/") or rel_posix.startswith(pref)
        for pref in allowed_prefixes
    )
    if not allowed:
        fail(
            f"Path {rel_posix!r} is outside allowed auto-commit state prefixes "
            f"({', '.join(allowed_prefixes)}). Commit code/config changes explicitly."
        )
    return rel_posix


def _filter_ignored(root: Path, rel_paths: list[str]) -> tuple[list[str], list[str]]:
    """Split `rel_paths` into `(kept, ignored)` using `git check-ignore`."""
    proc = subprocess.run(
        ["git", "check-ignore", "-z", "--stdin"],
        cwd=str(root),
        input="\0".join(rel_paths) + "\0",
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode not in (0, 1):
        # Unexpected error; treat none as ignored and let git surface real errors later
        return rel_paths, []
    ignored_set = {p for p in proc.stdout.split("\0") if p}
    kept = [p for p in rel_paths if p not in ignored_set]
    ignored = [p for p in rel_paths if p in ignored_set]
    return kept, ignored


def _log_event(
    root: Path,
    *,
    no_log: bool,
    action: str,
    reason: str | None = None,
    commit: str | None = None,
    paths: list[str] | None = None,
    ignored: list[str] | None = None,
) -> None:
    if no_log:
        return
    prefixes = sorted({p.split("/", 1)[0] for p in (paths or [])})
    append_telemetry(root, TELEMETRY_FILE, {
        "ts": now_local().isoformat(),
        "action": action,
        "reason": reason,
        "commit": commit,
        "path_count": len(paths or []),
        "ignored_count": len(ignored or []),
        "prefixes": prefixes,
    })


def cmd_validate(root: Path, _args: argparse.Namespace) -> None:
    prefixes, errors = load_auto_commit_config(root)
    if errors:
        print(json.dumps({"ok": False, "file": str(root / THOTH_CONFIG_FILE), "errors": errors}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    git_ok, git_reason = _check_git_ready(root)
    print(json.dumps({
        "ok": True,
        "config_present": (root / THOTH_CONFIG_FILE).exists(),
        "allowed_prefixes": prefixes,
        "git_ready": git_ok,
        "git_reason": git_reason,
    }, ensure_ascii=False))


def cmd_run(root: Path, args: argparse.Namespace) -> None:
    prefixes, errors = load_auto_commit_config(root)
    if errors:
        fail("; ".join(errors))

    msg = args.message.strip()
    if not msg:
        fail("Commit message (-m) must not be empty")
    check_secrets(msg, "message")

    # Deduplicate while preserving order
    rel_paths: list[str] = []
    seen: set[str] = set()
    for raw_p in args.paths:
        norm = _normalize_input_path(root, raw_p, prefixes)
        if norm not in seen:
            seen.add(norm)
            rel_paths.append(norm)

    git_ok, git_reason = _check_git_ready(root)
    if not git_ok:
        _log_event(root, no_log=args.no_log, action="skipped", reason=git_reason, paths=rel_paths)
        print(json.dumps({"ok": True, "action": "skipped", "reason": git_reason, "paths": rel_paths}, ensure_ascii=False))
        return

    kept, ignored = _filter_ignored(root, rel_paths)
    if not kept:
        _log_event(root, no_log=args.no_log, action="skipped", reason="all_ignored", paths=[], ignored=ignored)
        print(json.dumps({"ok": True, "action": "skipped", "reason": "all_ignored", "ignored": ignored}, ensure_ascii=False))
        return

    status = _git(root, "status", "--porcelain", "--untracked-files=all", "--", *kept)
    if status.returncode != 0:
        err = (status.stderr or status.stdout).strip() or "git status failed"
        _log_event(root, no_log=args.no_log, action="failed", reason="git_status_error", paths=kept, ignored=ignored)
        print(json.dumps({"ok": False, "action": "failed", "error": err, "files_preserved": True}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    if not status.stdout.strip():
        _log_event(root, no_log=args.no_log, action="skipped", reason="nothing_to_commit", paths=kept, ignored=ignored)
        print(json.dumps({"ok": True, "action": "skipped", "reason": "nothing_to_commit", "paths": kept, "ignored": ignored}, ensure_ascii=False))
        return

    if args.dry_run:
        print(json.dumps({
            "ok": True,
            "action": "dry_run",
            "message": msg,
            "paths": kept,
            "ignored": ignored,
        }, ensure_ascii=False))
        return

    add_proc = _git(root, "add", "-A", "--", *kept)
    if add_proc.returncode != 0:
        err = (add_proc.stderr or add_proc.stdout).strip() or "git add failed"
        _log_event(root, no_log=args.no_log, action="failed", reason="git_add_error", paths=kept, ignored=ignored)
        print(json.dumps({"ok": False, "action": "failed", "error": err, "files_preserved": True}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    commit_proc = _git(root, "commit", "-q", "-m", msg, "--", *kept)
    if commit_proc.returncode != 0:
        err = (commit_proc.stderr or commit_proc.stdout).strip() or "git commit failed"
        _log_event(root, no_log=args.no_log, action="failed", reason="git_commit_error", paths=kept, ignored=ignored)
        print(json.dumps({"ok": False, "action": "failed", "error": err, "files_preserved": True}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)

    sha = _git(root, "rev-parse", "--short", "HEAD").stdout.strip()
    _log_event(root, no_log=args.no_log, action="committed", commit=sha, paths=kept, ignored=ignored)
    print(json.dumps({
        "ok": True,
        "action": "committed",
        "commit": sha,
        "message": msg,
        "paths": kept,
        "ignored": ignored,
    }, ensure_ascii=False))


def cmd_stats(root: Path, args: argparse.Namespace) -> None:
    log_path = root / TELEMETRY_DIR / TELEMETRY_FILE
    if not log_path.exists():
        print(json.dumps({"ok": True, "total": 0, "by_action": {}, "skip_reasons": {}, "by_prefix": {}}, ensure_ascii=False))
        return

    cutoff = now_local() - timedelta(days=args.days) if args.days and args.days > 0 else None
    by_action: Counter[str] = Counter()
    skip_reasons: Counter[str] = Counter()
    by_prefix: Counter[str] = Counter()
    total = 0

    for line in log_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if cutoff is not None:
            try:
                if datetime.fromisoformat(ev.get("ts", "")) < cutoff:
                    continue
            except ValueError:
                continue
        total += 1
        act = str(ev.get("action", "unknown"))
        by_action[act] += 1
        if act == "skipped" and ev.get("reason"):
            skip_reasons[str(ev["reason"])] += 1
        for pref in ev.get("prefixes", []):
            by_prefix[str(pref)] += 1

    print(json.dumps({
        "ok": True,
        "days": args.days if args.days and args.days > 0 else "all",
        "total": total,
        "by_action": dict(by_action.most_common()),
        "skip_reasons": dict(skip_reasons.most_common()),
        "by_prefix": dict(by_prefix.most_common()),
    }, ensure_ascii=False))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="auto-commit", description="Safe, path-scoped local state commit CLI.")
    p.add_argument("--root", help="Instance root directory (default: current working directory).")
    p.add_argument("--allow-worktree", action="store_true", help="Allow running inside a linked git worktree.")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("validate", help="Validate [auto_commit] config in thoth.toml and check git readiness.")

    run = sub.add_parser("run", help="Stage and locally commit only the given state paths.")
    run.add_argument("-m", "--message", required=True, help="Concise commit summary.")
    run.add_argument("paths", nargs="+", help="Exact state paths touched in this turn (old and new on move/archive).")
    run.add_argument("--dry-run", action="store_true", help="Validate and inspect without modifying git.")
    run.add_argument("--no-log", action="store_true", help="Do not append to telemetry log.")

    st = sub.add_parser("stats", help="Summarize auto-commit telemetry.")
    st.add_argument("--days", type=int, default=30, help="Window in days (0 = all time; default 30).")

    return p


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    root = resolve_root(args.root, "auto-commit", allow_worktree=args.allow_worktree)
    dispatch = {
        "validate": cmd_validate,
        "run": cmd_run,
        "stats": cmd_stats,
    }
    dispatch[args.cmd](root, args)


if __name__ == "__main__":
    main()
