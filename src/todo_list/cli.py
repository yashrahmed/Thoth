#!/usr/bin/env python3
"""Thoth to-do list CRUD CLI (`todo-list`).

Design:
- 1 Markdown file with flat YAML frontmatter per task, any status:
      <root>/tasks/t-NNNN.md
  Soft-deleted tasks move to <root>/tasks/.archive/t-NNNN.md.
- IDs are `t-NNNN` (highest existing number + 1, allocated under the lock).
  Commands accept `t-42`, `t-0042`, or `42`.
- Body = free-form notes, then a CLI-owned `## Log` section:
      - <ISO-8601> | <change> | <reason>
- `source_keys` (`<channel>:<id>`) are unique across live + archived tasks, so
  intake can dedupe; `create` returns the existing task instead of duplicating.
- `revision` increments on every write; `expected_revision` refuses stale writes.
- Same storage guarantees as thoth-mem: OS file lock on <root>/tasks/.write.lock,
  atomic writes, strict `--json` keys, secret scanning, stdlib only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from thoth_core import (
    atomic_write,
    check_secrets,
    fail,
    normalize_list,
    now_local,
    parse_yaml_value,
    read_json_stdin,
    resolve_root,
    split_frontmatter,
    write_lock,
    yaml_scalar,
)

PROG = "todo-list"
STATUSES = ("open", "waiting", "done", "dropped")
ACTIVE_STATUSES = ("open", "waiting")
PRIORITIES = ("high", "normal", "low")
PRIORITY_RANK = {p: i for i, p in enumerate(PRIORITIES)}

TASK_ID_RE = re.compile(r"^t-(\d{4,})$")
LOOSE_ID_RE = re.compile(r"^(?:t-?)?(\d+)$", re.IGNORECASE)
SOURCE_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_.-]*:[^\s,]+$")
MEMORY_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$")  # local date, optional time
LOG_HEADING = "## Log"

FIELD_ORDER = (
    "id", "title", "status", "priority", "due", "scheduled",
    "source_keys", "memory_ids", "created", "updated", "revision",
)
REQUIRED_FIELDS = ("id", "title", "status", "priority", "created", "updated", "revision")
LIST_FIELDS = ("source_keys", "memory_ids")
DATE_FIELDS = ("due", "scheduled")

CREATE_JSON_KEYS = frozenset({
    "title", "status", "priority", "due", "scheduled",
    "source_keys", "memory_ids", "notes", "reason",
})
UPDATE_JSON_KEYS = frozenset({
    "title", "status", "priority", "due", "scheduled",
    "source_keys", "add_source_keys", "remove_source_keys",
    "memory_ids", "add_memory_ids", "remove_memory_ids",
    "notes", "append", "reason", "expected_revision",
})


# ---------------------------------------------------------------- paths & ids

def tasks_dir(root: Path) -> Path:
    return root / "tasks"


def archive_dir(root: Path) -> Path:
    return tasks_dir(root) / ".archive"


def format_id(num: int) -> str:
    return f"t-{num:04d}"


def normalize_id(raw: str) -> str:
    m = LOOSE_ID_RE.match(str(raw).strip())
    if not m:
        fail(f"Invalid task id {raw!r}; use t-42, t-0042, or 42")
    return format_id(int(m.group(1)))


def next_id(root: Path) -> str:
    highest = 0
    for folder in (tasks_dir(root), archive_dir(root)):
        if not folder.exists():
            continue
        for p in folder.glob("t-*.md"):
            if m := TASK_ID_RE.match(p.stem):
                highest = max(highest, int(m.group(1)))
    return format_id(highest + 1)


def rel(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


# ---------------------------------------------------------------- validation

def clean_title(val: Any) -> str:
    title = str(val or "").strip()
    if not title or "\n" in title:
        fail("title is required and must be a single line")
    check_secrets(title, "title")
    return title


def clean_choice(val: Any, choices: tuple[str, ...], field: str) -> str:
    v = str(val).strip().lower()
    if v not in choices:
        fail(f"Invalid {field} {val!r}; expected one of: {', '.join(choices)}")
    return v


def clean_date(val: Any, field: str) -> str:
    """Return a local YYYY-MM-DDTHH:MM string (a bare date gets T00:00), or '' to clear."""
    if val is None:
        return ""
    v = str(val).strip()
    if not v:
        return ""
    if not DATE_RE.match(v):
        fail(f"Invalid {field} {val!r}; use YYYY-MM-DD or YYYY-MM-DDTHH:MM")
    try:
        datetime.fromisoformat(v)
    except ValueError:
        fail(f"Invalid {field} {val!r}; not a real calendar date or time")
    return v if "T" in v else v + "T00:00"


def clean_source_keys(val: Any) -> list[str]:
    out: list[str] = []
    for k in normalize_list(val):
        if not SOURCE_KEY_RE.match(k):
            fail(f"Invalid source key {k!r}; use <channel>:<id> with a lowercase channel and no spaces or commas")
        check_secrets(k, "source_keys")
        if k not in out:
            out.append(k)
    return out


def clean_memory_ids(val: Any) -> list[str]:
    out: list[str] = []
    for m in normalize_list(val):
        if not MEMORY_ID_RE.match(m):
            fail(f"Invalid memory id {m!r}")
        check_secrets(m, "memory_ids")
        if m not in out:
            out.append(m)
    return out


def clean_notes(val: Any, field: str) -> str:
    text = str(val or "").strip()
    check_secrets(text, field)
    if any(line.strip() == LOG_HEADING for line in text.splitlines()):
        fail(f"{field} must not contain a '{LOG_HEADING}' line; that section is managed by {PROG}")
    return text


def clean_reason(val: Any) -> str:
    reason = " ".join(str(val or "").split())
    check_secrets(reason, "reason")
    return reason


# ---------------------------------------------------------------- file format

def split_body(body: str) -> tuple[str, list[str]]:
    lines = body.splitlines()
    idx = None
    for i, line in enumerate(lines):
        if line.strip() == LOG_HEADING:
            idx = i
    if idx is None:
        return body.strip(), []
    notes = "\n".join(lines[:idx]).strip()
    log = [ln.strip()[2:].strip() for ln in lines[idx + 1 :] if ln.strip().startswith("- ")]
    return notes, log


def parse_task_file(path: Path, archived: bool) -> dict[str, Any]:
    fm_lines, body = split_frontmatter(path.read_text(encoding="utf-8"), path)
    meta: dict[str, Any] = {}
    for line in fm_lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        k, sep, v = line.partition(":")
        k = k.strip()
        if not sep:
            raise ValueError(f"Malformed frontmatter line {line!r}")
        if k in meta:
            raise ValueError(f"Duplicate key {k!r}")
        if k not in FIELD_ORDER:
            raise ValueError(f"Unknown key {k!r}")
        meta[k] = parse_yaml_value(v)
    missing = [f for f in REQUIRED_FIELDS if f not in meta or meta[f] in ("", None)]
    if missing:
        raise ValueError(f"Missing required key(s): {', '.join(missing)}")
    if not TASK_ID_RE.match(str(meta["id"])) or meta["id"] != path.stem:
        raise ValueError(f"id {meta['id']!r} does not match filename {path.name!r}")
    if meta["status"] not in STATUSES:
        raise ValueError(f"Invalid status {meta['status']!r}")
    if meta["priority"] not in PRIORITIES:
        raise ValueError(f"Invalid priority {meta['priority']!r}")
    try:
        meta["revision"] = int(str(meta["revision"]))
    except ValueError:
        raise ValueError(f"Invalid revision {meta['revision']!r}") from None
    if meta["revision"] < 1:
        raise ValueError("revision must be >= 1")
    for f in DATE_FIELDS:
        v = str(meta.get(f) or "")
        if v:
            if not DATE_RE.match(v):
                raise ValueError(f"Invalid {f} {v!r}")
            datetime.fromisoformat(v)
        meta[f] = v
    for f in LIST_FIELDS:
        val = meta.get(f, [])
        if val in ("", None):
            val = []
        if not isinstance(val, list):
            raise ValueError(f"{f} must be an inline JSON list")
        meta[f] = [str(x) for x in val]
    notes, log = split_body(body)
    return {"meta": meta, "notes": notes, "log": log, "path": path, "archived": archived}


def render_task(meta: dict[str, Any], notes: str, log: list[str]) -> str:
    lines = ["---"]
    for f in FIELD_ORDER:
        val = meta.get(f)
        if f in LIST_FIELDS:
            lines.append(f"{f}: {json.dumps(val or [], ensure_ascii=False)}")
        elif f == "revision":
            lines.append(f"revision: {int(val)}")
        elif f in DATE_FIELDS:
            if val:
                lines.append(f"{f}: {json.dumps(val)}")
        else:
            lines.append(f"{f}: {yaml_scalar(str(val))}")
    lines += ["---", ""]
    if notes.strip():
        lines += [notes.strip(), ""]
    lines.append(LOG_HEADING)
    lines += [f"- {entry}" for entry in log]
    lines.append("")
    return "\n".join(lines)


def log_entry(change: str, reason: str = "") -> str:
    entry = f"{now_local().isoformat()} | {change}"
    return f"{entry} | {reason}" if reason else entry


def load_tasks(root: Path, include_archived: bool) -> tuple[list[dict[str, Any]], list[str]]:
    tasks: list[dict[str, Any]] = []
    errors: list[str] = []
    folders = [(tasks_dir(root), False)]
    if include_archived:
        folders.append((archive_dir(root), True))
    for folder, archived in folders:
        if not folder.exists():
            continue
        for p in sorted(folder.glob("*.md")):
            try:
                tasks.append(parse_task_file(p, archived))
            except Exception as e:  # noqa: BLE001 - report every unreadable file
                errors.append(f"{rel(root, p)}: {e}")
    return tasks, errors


def load_tasks_for_write(root: Path) -> list[dict[str, Any]]:
    """All live + archived tasks; refuse to write if any file is unreadable (dedupe safety)."""
    tasks, errors = load_tasks(root, include_archived=True)
    if errors:
        fail("Refusing to write while task files are unreadable; fix them first: " + "; ".join(errors))
    return tasks


def find_task(tasks: list[dict[str, Any]], task_id: str) -> dict[str, Any] | None:
    for t in tasks:
        if t["meta"]["id"] == task_id:
            return t
    return None


def task_view(root: Path, t: dict[str, Any], *, full: bool = False) -> dict[str, Any]:
    m = t["meta"]
    row: dict[str, Any] = {
        "id": m["id"],
        "title": m["title"],
        "status": m["status"],
        "priority": m["priority"],
    }
    for f in DATE_FIELDS:
        if m.get(f):
            row[f] = m[f]
    for f in LIST_FIELDS:
        if m.get(f) or full:
            row[f] = m.get(f, [])
    row["revision"] = m["revision"]
    row["updated"] = m["updated"]
    if full:
        row["created"] = m["created"]
        row["notes"] = t["notes"]
        row["log"] = t["log"]
    row["path"] = rel(root, t["path"])
    if t["archived"]:
        row["archived"] = True
    return row


def sort_key(t: dict[str, Any]) -> tuple[str, int, int]:
    m = t["meta"]
    return (m.get("due") or "9999-12-31", PRIORITY_RANK[m["priority"]], int(m["id"][2:]))


def check_source_conflicts(tasks: list[dict[str, Any]], keys: list[str], own_id: str) -> None:
    for t in tasks:
        if t["meta"]["id"] == own_id:
            continue
        clash = sorted(set(keys) & set(t["meta"]["source_keys"]))
        if clash:
            fail(f"Source key(s) {', '.join(clash)} already belong to {t['meta']['id']}")


# ---------------------------------------------------------------- commands

def cmd_create(args: argparse.Namespace, root: Path) -> None:
    payload = read_json_stdin(CREATE_JSON_KEYS, "create") if args.json else {}

    def pick(flag_val: Any, key: str) -> Any:
        return flag_val if flag_val is not None else payload.get(key)

    title = clean_title(pick(args.title, "title"))
    status = clean_choice(pick(args.status, "status") or "open", STATUSES, "status")
    priority = clean_choice(pick(args.priority, "priority") or "normal", PRIORITIES, "priority")
    due = clean_date(pick(args.due, "due"), "due")
    scheduled = clean_date(pick(args.scheduled, "scheduled"), "scheduled")
    source_keys = clean_source_keys(pick(args.source_key, "source_keys"))
    memory_ids = clean_memory_ids(pick(args.memory_id, "memory_ids"))
    notes = clean_notes(pick(args.notes, "notes"), "notes")
    reason = clean_reason(pick(args.reason, "reason"))

    with write_lock(tasks_dir(root)):
        tasks = load_tasks_for_write(root)
        if source_keys:
            hits = [t for t in tasks if set(source_keys) & set(t["meta"]["source_keys"])]
            if len(hits) > 1:
                ids = ", ".join(t["meta"]["id"] for t in hits)
                fail(f"Conflict: source keys match more than one task ({ids})")
            if hits:
                existing = hits[0]
                matched = [k for k in source_keys if k in existing["meta"]["source_keys"]]
                print(json.dumps({
                    "ok": True,
                    "action": "existing",
                    "matched_keys": matched,
                    "unmatched_keys": [k for k in source_keys if k not in matched],
                    **task_view(root, existing),
                }, ensure_ascii=False))
                return

        ts = now_local().isoformat()
        task_id = next_id(root)
        meta = {
            "id": task_id,
            "title": title,
            "status": status,
            "priority": priority,
            "due": due,
            "scheduled": scheduled,
            "source_keys": source_keys,
            "memory_ids": memory_ids,
            "created": ts,
            "updated": ts,
            "revision": 1,
        }
        log = [log_entry(f"created ({status})", reason)]
        path = tasks_dir(root) / f"{task_id}.md"
        atomic_write(path, render_task(meta, notes, log))
        task = {"meta": meta, "notes": notes, "log": log, "path": path, "archived": False}

    print(json.dumps({"ok": True, "action": "created", **task_view(root, task)}, ensure_ascii=False))


def cmd_read(args: argparse.Namespace, root: Path) -> None:
    task_id = normalize_id(args.id)
    for path, archived in ((tasks_dir(root) / f"{task_id}.md", False), (archive_dir(root) / f"{task_id}.md", True)):
        if path.exists():
            break
    else:
        fail(f"Task not found: {task_id}")
    if args.md:
        sys.stdout.write(path.read_text(encoding="utf-8"))
        return
    try:
        task = parse_task_file(path, archived)
    except Exception as e:  # noqa: BLE001
        fail(f"{rel(root, path)}: {e}")
    print(json.dumps({"ok": True, "task": task_view(root, task, full=True)}, ensure_ascii=False, indent=2))


def cmd_list(args: argparse.Namespace, root: Path) -> None:
    source_filter = clean_source_keys([k for group in (args.source or []) for k in normalize_list(group)])
    if args.status:
        statuses = set(STATUSES) if "all" in args.status else set(args.status)
    elif source_filter:
        statuses = set(STATUSES)
    else:
        statuses = set(ACTIVE_STATUSES)
    if args.actionable:
        statuses &= set(ACTIVE_STATUSES)
    due_by = clean_date(args.due_by, "due-by")[:10] if args.due_by else ""
    until = clean_date(args.until, "until") if args.until else ""
    if until and "T" not in args.until:
        until = until[:10] + "T23:59"  # a bare date means through the end of that day
    today = now_local().date().isoformat()

    tasks, warnings = load_tasks(root, include_archived=args.archived or bool(source_filter))
    rows = []
    for t in sorted(tasks, key=sort_key):
        m = t["meta"]
        if m["status"] not in statuses:
            continue
        if args.priority and m["priority"] != args.priority:
            continue
        if due_by and not (m["due"] and m["due"][:10] <= due_by):
            continue
        dates = [d for d in (m["due"], m["scheduled"]) if d]
        if until and dates and min(dates) > until:  # undated tasks always pass
            continue
        if source_filter and not set(source_filter) & set(m["source_keys"]):
            continue
        if args.actionable:
            if t["archived"]:
                continue
            sched = m["scheduled"]
            sched = sched[:10]
            ready = (not sched or sched <= today) if m["status"] == "open" else bool(sched and sched <= today)
            if not ready:
                continue
        rows.append(t)
    owners = {k: t["meta"]["id"] for t in rows for k in t["meta"]["source_keys"] if k in source_filter}
    if args.limit and args.limit > 0:
        rows = rows[: args.limit]

    out: dict[str, Any] = {
        "ok": True,
        "count": len(rows),
        "tasks": [task_view(root, t, full=args.full) for t in rows],
    }
    if source_filter:
        out["matched_keys"] = owners
        out["unmatched_keys"] = [k for k in source_filter if k not in owners]
    if warnings:
        out["warnings"] = warnings
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_search(args: argparse.Namespace, root: Path) -> None:
    raw_query = args.query.strip()
    if not raw_query:
        fail("Search query must not be empty")
    literal = args.exact or any(ch in raw_query for ch in ("://", "/", ":", "."))
    tokens = [raw_query.lower()] if literal else [t.lower() for t in re.findall(r"[A-Za-z0-9_-]+", raw_query)]
    if not tokens:
        fail("Search query must contain at least one searchable term")
    statuses = set(STATUSES) if not args.status or "all" in args.status else set(args.status)

    tasks, warnings = load_tasks(root, include_archived=args.archived)
    hits = []
    for t in tasks:
        m = t["meta"]
        if m["status"] not in statuses:
            continue
        haystack = " ".join([
            m["title"], t["notes"], " ".join(t["log"]),
            " ".join(m["source_keys"]), " ".join(m["memory_ids"]),
        ]).lower()
        matched = sum(1 for tok in tokens if tok in haystack)
        if matched == 0 or (args.all_terms and matched < len(tokens)):
            continue
        score = matched * 100 + min(sum(haystack.count(tok) for tok in tokens), 99)
        row = task_view(root, t)
        row["score"] = score
        row["snippet"] = t["notes"][:200] + ("..." if len(t["notes"]) > 200 else "")
        hits.append(row)
    hits.sort(key=lambda h: (-h["score"], int(h["id"][2:])))
    if args.limit and args.limit > 0:
        hits = hits[: args.limit]
    out: dict[str, Any] = {"ok": True, "query": raw_query, "count": len(hits), "hits": hits}
    if warnings:
        out["warnings"] = warnings
    print(json.dumps(out, ensure_ascii=False, indent=2))


def apply_update(root: Path, task_id: str, changes: dict[str, Any]) -> None:
    """Apply normalized `changes` to a live task under the lock and print the result."""
    with write_lock(tasks_dir(root)):
        tasks = load_tasks_for_write(root)
        task = find_task(tasks, task_id)
        if task is None:
            fail(f"Task not found: {task_id}")
        if task["archived"]:
            fail(f"Task {task_id} is archived; restore it before updating")
        meta, notes, log = dict(task["meta"]), task["notes"], list(task["log"])

        expected = changes.pop("expected_revision", None)
        if expected is not None and int(expected) != meta["revision"]:
            fail(f"Conflict: expected revision {expected}, found {meta['revision']}")

        reason = changes.pop("reason", "")
        old_status = meta["status"]
        for f in ("title", "status", "priority", "due", "scheduled"):
            if f in changes:
                meta[f] = changes[f]

        keys = list(changes.get("source_keys", meta["source_keys"]))
        keys += [k for k in changes.get("add_source_keys", []) if k not in keys]
        keys = [k for k in keys if k not in set(changes.get("remove_source_keys", []))]
        check_source_conflicts(tasks, keys, task_id)
        meta["source_keys"] = keys

        mids = list(changes.get("memory_ids", meta["memory_ids"]))
        mids += [m for m in changes.get("add_memory_ids", []) if m not in mids]
        meta["memory_ids"] = [m for m in mids if m not in set(changes.get("remove_memory_ids", []))]

        if "notes" in changes:
            notes = changes["notes"]
        if changes.get("append"):
            notes = (notes.rstrip() + "\n\n" + changes["append"]).strip()

        if meta["status"] != old_status:
            log.append(log_entry(f"{old_status} -> {meta['status']}", reason))
        elif reason:
            log.append(log_entry("note", reason))

        new_meta_cmp = {k: v for k, v in meta.items() if k not in ("updated", "revision")}
        old_meta_cmp = {k: v for k, v in task["meta"].items() if k not in ("updated", "revision")}
        if new_meta_cmp == old_meta_cmp and notes == task["notes"] and log == task["log"]:
            print(json.dumps({"ok": True, "action": "unchanged", **task_view(root, task)}, ensure_ascii=False))
            return

        meta["revision"] += 1
        meta["updated"] = now_local().isoformat()
        atomic_write(task["path"], render_task(meta, notes, log))
        task = {**task, "meta": meta, "notes": notes, "log": log}

    print(json.dumps({"ok": True, "action": "updated", **task_view(root, task)}, ensure_ascii=False))


def cmd_update(args: argparse.Namespace, root: Path) -> None:
    payload = read_json_stdin(UPDATE_JSON_KEYS, "update") if args.json else {}
    flags = {
        "title": args.title, "status": args.status, "priority": args.priority,
        "due": args.due, "scheduled": args.scheduled,
        "add_source_keys": args.add_source_key, "remove_source_keys": args.remove_source_key,
        "add_memory_ids": args.add_memory_id, "remove_memory_ids": args.remove_memory_id,
        "notes": args.notes, "append": args.append, "reason": args.reason,
        "expected_revision": args.expected_revision,
    }
    raw = {**payload, **{k: v for k, v in flags.items() if v is not None}}
    if not set(raw) - {"reason", "expected_revision"} and not raw.get("reason"):
        fail("Nothing to update; pass at least one field (or a reason)")

    changes: dict[str, Any] = {}
    if "title" in raw:
        changes["title"] = clean_title(raw["title"])
    if "status" in raw:
        changes["status"] = clean_choice(raw["status"], STATUSES, "status")
    if "priority" in raw:
        changes["priority"] = clean_choice(raw["priority"], PRIORITIES, "priority")
    for f in DATE_FIELDS:
        if f in raw:
            changes[f] = clean_date(raw[f], f)
    for f in ("source_keys", "add_source_keys", "remove_source_keys"):
        if f in raw:
            changes[f] = clean_source_keys(raw[f])
    for f in ("memory_ids", "add_memory_ids", "remove_memory_ids"):
        if f in raw:
            changes[f] = clean_memory_ids(raw[f])
    if "notes" in raw:
        changes["notes"] = clean_notes(raw["notes"], "notes")
    if "append" in raw:
        changes["append"] = clean_notes(raw["append"], "append")
    if "reason" in raw:
        changes["reason"] = clean_reason(raw["reason"])
    rev = raw.get("expected_revision")
    if rev is not None:
        if isinstance(rev, bool) or not isinstance(rev, int):
            fail(f"expected_revision must be an integer, got {rev!r}")
        changes["expected_revision"] = rev
    apply_update(root, normalize_id(args.id), changes)


def cmd_done(args: argparse.Namespace, root: Path) -> None:
    changes: dict[str, Any] = {"status": "done", "reason": clean_reason(args.reason)}
    if args.expected_revision is not None:
        changes["expected_revision"] = args.expected_revision
    apply_update(root, normalize_id(args.id), changes)


def cmd_delete(args: argparse.Namespace, root: Path) -> None:
    task_id = normalize_id(args.id)
    with write_lock(tasks_dir(root)):
        path = tasks_dir(root) / f"{task_id}.md"
        if not path.exists():
            fail(f"Task not found: {task_id}")
        if args.hard:
            path.unlink()
            print(json.dumps({"ok": True, "id": task_id, "action": "hard_deleted"}))
            return
        task = load_and_check(root, path, archived=False)
        dest = archive_dir(root) / path.name
        if dest.exists():
            fail(f"Archive already holds {dest.name}")
        meta = dict(task["meta"])
        log = task["log"] + [log_entry("archived", clean_reason(args.reason))]
        meta["revision"] += 1
        meta["updated"] = now_local().isoformat()
        atomic_write(dest, render_task(meta, task["notes"], log))
        path.unlink()
    print(json.dumps({"ok": True, "action": "archived", **task_view(root, {**task, "meta": meta, "log": log, "path": dest, "archived": True})}, ensure_ascii=False))


def cmd_restore(args: argparse.Namespace, root: Path) -> None:
    task_id = normalize_id(args.id)
    with write_lock(tasks_dir(root)):
        src = archive_dir(root) / f"{task_id}.md"
        if not src.exists():
            fail(f"Archived task not found: {task_id}")
        dest = tasks_dir(root) / src.name
        if dest.exists():
            fail(f"A live task {task_id} already exists")
        load_tasks_for_write(root)
        task = load_and_check(root, src, archived=True)
        meta = dict(task["meta"])
        log = task["log"] + [log_entry("restored")]
        meta["revision"] += 1
        meta["updated"] = now_local().isoformat()
        atomic_write(dest, render_task(meta, task["notes"], log))
        src.unlink()
    print(json.dumps({"ok": True, "action": "restored", **task_view(root, {**task, "meta": meta, "log": log, "path": dest, "archived": False})}, ensure_ascii=False))


def load_and_check(root: Path, path: Path, archived: bool) -> dict[str, Any]:
    try:
        return parse_task_file(path, archived)
    except Exception as e:  # noqa: BLE001
        fail(f"{rel(root, path)}: {e}")
        raise


# ---------------------------------------------------------------- parser

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog=PROG, description="Thoth to-do list CRUD CLI")
    p.add_argument("--root", help="Instance root (default: the current folder; mainly for tests)")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("create", help="Create a task (prefer --json <<'EOF'); returns the existing task if a source key matches")
    c.add_argument("--title")
    c.add_argument("--status", choices=STATUSES)
    c.add_argument("--priority", choices=PRIORITIES)
    c.add_argument("--due", help="Deadline YYYY-MM-DD[THH:MM]; a bare date is stored as T00:00")
    c.add_argument("--scheduled", help="Work-on / follow-up date YYYY-MM-DD[THH:MM]")
    c.add_argument("--source-key", help="Comma-separated <channel>:<id> dedupe keys")
    c.add_argument("--memory-id", help="Comma-separated linked memory episode IDs")
    c.add_argument("--notes", help="Markdown notes")
    c.add_argument("--reason", help="One-line reason recorded in the log")
    c.add_argument("--json", action="store_true", help="Read JSON object on stdin (strictly validates keys)")

    r = sub.add_parser("read", help="Read one task (live or archived) by ID")
    r.add_argument("id")
    r.add_argument("--md", action="store_true", help="Print the raw Markdown file instead of JSON")

    ls = sub.add_parser("list", help="List tasks (default: open + waiting), sorted by due, priority, id")
    ls.add_argument("--status", action="append", choices=STATUSES + ("all",), help="Status filter (repeatable, or 'all')")
    ls.add_argument("--priority", choices=PRIORITIES)
    ls.add_argument("--actionable", action="store_true", help="Open tasks not scheduled for later + waiting tasks whose follow-up date has come")
    ls.add_argument("--due-by", help="Only tasks due on or before YYYY-MM-DD")
    ls.add_argument("--until", help="Only tasks whose earlier of due/scheduled is at or before YYYY-MM-DD[THH:MM] (bare date = end of that day); undated tasks always pass")
    ls.add_argument("--source", action="append", help="Match source keys (repeatable/comma-separated); searches every status incl. archived")
    ls.add_argument("--limit", type=int, default=0)
    ls.add_argument("--full", action="store_true", help="Include notes, log, and timestamps")
    ls.add_argument("--archived", action="store_true", help="Also include archived tasks")

    s = sub.add_parser("search", help="Keyword or exact search across title, notes, log, source keys, and memory IDs")
    s.add_argument("query")
    s.add_argument("--exact", action="store_true", help="Match one case-insensitive substring instead of splitting words")
    s.add_argument("--status", action="append", choices=STATUSES + ("all",), help="Status filter (default: all)")
    s.add_argument("--all-terms", action="store_true", help="Require all query terms to match")
    s.add_argument("--archived", action="store_true", help="Also search archived tasks")
    s.add_argument("--limit", type=int, default=15)

    u = sub.add_parser("update", help="Update a task by ID (bumps revision; logs status changes)")
    u.add_argument("id")
    u.add_argument("--title")
    u.add_argument("--status", choices=STATUSES)
    u.add_argument("--priority", choices=PRIORITIES)
    u.add_argument("--due", help="Deadline YYYY-MM-DD[THH:MM] ('' clears)")
    u.add_argument("--scheduled", help="Work-on / follow-up date YYYY-MM-DD[THH:MM] ('' clears)")
    u.add_argument("--add-source-key", help="Comma-separated source keys to attach")
    u.add_argument("--remove-source-key", help="Comma-separated source keys to detach")
    u.add_argument("--add-memory-id", help="Comma-separated memory IDs to link")
    u.add_argument("--remove-memory-id", help="Comma-separated memory IDs to unlink")
    u.add_argument("--notes", help="Replace notes")
    u.add_argument("--append", help="Append to notes")
    u.add_argument("--reason", help="One-line reason recorded in the log")
    u.add_argument("--expected-revision", type=int, help="Refuse the write unless the task is at this revision")
    u.add_argument("--json", action="store_true", help="Read JSON object on stdin (strictly validates keys)")

    d = sub.add_parser("done", help="Mark a task done")
    d.add_argument("id")
    d.add_argument("--reason", help="One-line reason recorded in the log")
    d.add_argument("--expected-revision", type=int)

    dl = sub.add_parser("delete", help="Archive (soft-delete) a task; its source keys stay reserved")
    dl.add_argument("id")
    dl.add_argument("--reason", help="One-line reason recorded in the log")
    dl.add_argument("--hard", action="store_true", help="Permanently delete instead of archiving")

    rs = sub.add_parser("restore", help="Restore an archived task")
    rs.add_argument("id")
    return p


def main() -> None:
    args = build_parser().parse_args()
    root = resolve_root(args.root, PROG)
    {
        "create": cmd_create,
        "read": cmd_read,
        "list": cmd_list,
        "search": cmd_search,
        "update": cmd_update,
        "done": cmd_done,
        "delete": cmd_delete,
        "restore": cmd_restore,
    }[args.cmd](args, root)


if __name__ == "__main__":
    main()
