#!/usr/bin/env python3
"""Thoth v2 episodic memory CRUD CLI.

Design:
- 1 Markdown file with flat YAML frontmatter per episode:
      <root>/memory/episodes/YYYY-MM/YYYYMMDD-HHMMSS-<4hex>.md
- OS file lock (`fcntl.flock` on Unix, `msvcrt.locking` on Windows) on:
      <root>/memory/.write.lock
- Atomic writes (`tmp` -> `fsync` -> `os.replace`) so readers never see partial files.
- Stdlib-only Python (zero runtime dependencies).
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import secrets
import shutil
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

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


VALID_KINDS = ("event", "decision", "action", "feedback", "check", "note", "commitment")
TOPIC_RE = re.compile(r"^[a-z0-9]+(?:[/-][a-z0-9]+)*$")
ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
REL_DURATION_RE = re.compile(r"^(\d+)\s*(h|d|w|m)$", re.IGNORECASE)
YM_DIR_RE = re.compile(r"^\d{4}-\d{2}$")

SECRET_PATTERNS = (
    ("private key", re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")),
    ("API key", re.compile(r"\bsk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{20,}\b")),
    ("GitHub token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
)


def get_tz() -> ZoneInfo:
    tz_name = os.environ.get("THOTH_TZ")
    if tz_name:
        return ZoneInfo(tz_name)
    # Fall back to local system timezone offset via ZoneInfo or America/Chicago
    try:
        local_tz = datetime.now().astimezone().tzinfo
        if local_tz is not None and hasattr(local_tz, "key"):
            return ZoneInfo(local_tz.key)
    except Exception:
        pass
    return ZoneInfo("UTC")


def now_local() -> datetime:
    tz_name = os.environ.get("THOTH_TZ")
    if tz_name:
        return datetime.now(ZoneInfo(tz_name)).replace(microsecond=0)
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


def resolve_root(root_arg: str | None) -> Path:
    if root_arg:
        return Path(root_arg).expanduser().resolve()
    env_root = os.environ.get("THOTH_ROOT")
    if env_root:
        return Path(env_root).expanduser().resolve()
    return Path.cwd().resolve()


@contextlib.contextmanager
def write_lock(root: Path):
    mem_dir = root / "memory"
    mem_dir.mkdir(parents=True, exist_ok=True)
    lock_path = mem_dir / ".write.lock"
    fh = open(lock_path, "a+")
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


def render_episode(meta: dict[str, Any], body: str) -> str:
    lines = [
        "---",
        f"id: {yaml_scalar(meta['id'])}",
        f"when: {yaml_scalar(meta['when'])}",
        f"kind: {yaml_scalar(meta['kind'])}",
        f"topic: {yaml_scalar(meta['topic'])}",
        f"title: {yaml_scalar(meta['title'])}",
        f"tags: {json.dumps(meta.get('tags', []), ensure_ascii=False)}",
        f"sources: {json.dumps(meta.get('sources', []), ensure_ascii=False)}",
    ]
    if meta.get("updated"):
        lines.append(f"updated: {yaml_scalar(meta['updated'])}")
    lines.append("---")
    lines.append("")
    lines.append(body.rstrip())
    lines.append("")
    return "\n".join(lines)


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


def parse_episode_file(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding="utf-8")
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
    meta: dict[str, Any] = {}
    for line in text[4:end].splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        k, sep, v = line.partition(":")
        if not sep:
            continue
        meta[k.strip()] = parse_yaml_value(v)
    meta.setdefault("tags", [])
    meta.setdefault("sources", [])
    if isinstance(meta["tags"], str):
        meta["tags"] = [t.strip() for t in meta["tags"].split(",") if t.strip()]
    if isinstance(meta["sources"], str):
        meta["sources"] = [s.strip() for s in meta["sources"].split(",") if s.strip()]
    return {"meta": meta, "body": body.rstrip("\n"), "path": str(path)}


def parse_timestamp(raw: str | None, *, default_now: bool = True) -> datetime:
    cur = now_local()
    if not raw:
        if default_now:
            return cur
        raise ValueError("Timestamp required")
    s = raw.strip()
    # Relative duration: 24h, 7d, 2w, 1m (30d)
    if m := REL_DURATION_RE.match(s):
        qty = int(m.group(1))
        unit = m.group(2).lower()
        mult = {"h": timedelta(hours=1), "d": timedelta(days=1), "w": timedelta(weeks=1), "m": timedelta(days=30)}[unit]
        return (cur - mult * qty).replace(microsecond=0)
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=cur.tzinfo)
        except ValueError:
            pass
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=cur.tzinfo)
        else:
            dt = dt.astimezone(cur.tzinfo)
        return dt.replace(microsecond=0)
    except ValueError:
        fail(f"Invalid timestamp {s!r}; use YYYY-MM-DD, 'YYYY-MM-DD HH:MM', ISO-8601, or relative (24h, 7d, 2w, 1m)")
        raise


def parse_range_bounds(since: str | None, until: str | None) -> tuple[datetime | None, datetime | None]:
    since_dt = parse_timestamp(since, default_now=False) if since else None
    until_dt = None
    if until:
        raw = until.strip()
        # Date-only --until is inclusive through 23:59:59 of that day
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
            until_dt = parse_timestamp(f"{raw} 23:59:59", default_now=False)
        else:
            until_dt = parse_timestamp(raw, default_now=False)
    return since_dt, until_dt


def iter_episode_files(
    root: Path,
    *,
    include_archived: bool = False,
    since_dt: datetime | None = None,
    until_dt: datetime | None = None,
) -> list[Path]:
    ep_dir = root / "memory" / "episodes"
    if not ep_dir.exists():
        return []
    since_ym = since_dt.strftime("%Y-%m") if since_dt else None
    until_ym = until_dt.strftime("%Y-%m") if until_dt else None

    out: list[Path] = []
    for entry in sorted(ep_dir.iterdir()):
        if entry.is_dir():
            name = entry.name
            if name == ".archive":
                if include_archived:
                    out.extend(sorted(entry.glob("*.md")))
                continue
            if YM_DIR_RE.match(name):
                if since_ym and name < since_ym:
                    continue
                if until_ym and name > until_ym:
                    continue
            out.extend(sorted(entry.rglob("*.md")))
        elif entry.is_file() and entry.suffix == ".md":
            out.append(entry)
    return out


def find_episode_by_id(root: Path, ep_id: str, include_archived: bool = False) -> Path | None:
    files = iter_episode_files(root, include_archived=include_archived)
    for p in files:
        if p.stem == ep_id or p.stem.endswith(ep_id):
            try:
                if parse_episode_file(p)["meta"].get("id") == ep_id:
                    return p
            except Exception:
                continue
    for p in files:
        try:
            if parse_episode_file(p)["meta"].get("id") == ep_id:
                return p
        except Exception:
            continue
    return None


def normalize_list(val: Any) -> list[str]:
    if not val:
        return []
    if isinstance(val, list):
        return [str(x).strip() for x in val if str(x).strip()]
    return [x.strip() for x in str(val).split(",") if x.strip()]


def record_in_range(when_str: str, since_dt: datetime | None, until_dt: datetime | None) -> bool:
    if since_dt is None and until_dt is None:
        return True
    try:
        dt = parse_timestamp(when_str, default_now=False)
    except SystemExit:
        return False
    if since_dt is not None and dt < since_dt:
        return False
    if until_dt is not None and dt > until_dt:
        return False
    return True


def cmd_create(args: argparse.Namespace, root: Path) -> None:
    payload: dict[str, Any] = {}
    if args.json:
        raw = sys.stdin.read()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            fail(f"Invalid JSON on stdin: {e}")

    kind = (args.kind or payload.get("kind") or "note").strip().lower()
    if kind not in VALID_KINDS:
        fail(f"Invalid kind {kind!r}; expected one of: {', '.join(VALID_KINDS)}")

    topic = (args.topic or payload.get("topic") or "").strip().lower()
    if not topic or not TOPIC_RE.match(topic):
        fail(f"Invalid topic {topic!r}; use lowercase slug like 'thoth-v2' or 'orders/refund'")

    title = (args.title or payload.get("title") or "").strip()
    if not title or "\n" in title:
        fail("title is required and must be a single line")

    body = args.body if args.body is not None else payload.get("body")
    if body is None and not args.json and not sys.stdin.isatty():
        body = sys.stdin.read()
    body = (body or "").strip()
    if not body:
        fail("body is required (use --json <<'EOF', --body, or pipe stdin)")

    tags = normalize_list(args.tags if args.tags is not None else payload.get("tags"))
    sources = normalize_list(args.sources if args.sources is not None else payload.get("sources"))
    when_dt = parse_timestamp(args.when or payload.get("when"), default_now=True)
    when_iso = when_dt.isoformat()
    ym = when_dt.strftime("%Y-%m")
    stamp = when_dt.strftime("%Y%m%d-%H%M%S")

    check_secrets(title, "title")
    check_secrets(body, "body")
    for s in sources:
        check_secrets(s, "sources")

    with write_lock(root):
        ep_id = (args.id or payload.get("id") or f"{stamp}-{secrets.token_hex(2)}").strip()
        if not ID_RE.match(ep_id):
            fail(f"Invalid id {ep_id!r}")
        if find_episode_by_id(root, ep_id, include_archived=True) is not None:
            fail(f"Episode with id {ep_id!r} already exists")
        path = root / "memory" / "episodes" / ym / f"{ep_id}.md"
        meta = {
            "id": ep_id,
            "when": when_iso,
            "kind": kind,
            "topic": topic,
            "title": title,
            "tags": tags,
            "sources": sources,
        }
        atomic_write(path, render_episode(meta, body))

    print(json.dumps({
        "ok": True,
        "id": ep_id,
        "when": when_iso,
        "kind": kind,
        "topic": topic,
        "title": title,
        "tags": tags,
        "body_preview": body[:160] + ("..." if len(body) > 160 else ""),
        "path": str(path.relative_to(root)),
    }, ensure_ascii=False))


def cmd_read(args: argparse.Namespace, root: Path) -> None:
    p = find_episode_by_id(root, args.id, include_archived=args.archived)
    if p is None:
        fail(f"Episode not found: {args.id}")
    if args.md:
        sys.stdout.write(p.read_text(encoding="utf-8"))
        return
    rec = parse_episode_file(p)
    rec["path"] = str(p.relative_to(root))
    print(json.dumps({"ok": True, **rec}, ensure_ascii=False, indent=2))


def cmd_list(args: argparse.Namespace, root: Path) -> None:
    since_dt, until_dt = parse_range_bounds(args.since, args.until)
    items = []
    for p in iter_episode_files(root, include_archived=args.archived, since_dt=since_dt, until_dt=until_dt):
        try:
            rec = parse_episode_file(p)
        except Exception:
            continue
        m = rec["meta"]
        when_val = str(m.get("when", ""))
        if not record_in_range(when_val, since_dt, until_dt):
            continue
        if args.topic and args.topic.lower() not in str(m.get("topic", "")).lower():
            continue
        if args.kind and str(m.get("kind", "")).lower() != args.kind.lower():
            continue
        if args.tag and args.tag.lower() not in [t.lower() for t in m.get("tags", [])]:
            continue
        row: dict[str, Any] = {
            "id": m.get("id"),
            "when": when_val,
            "kind": m.get("kind"),
            "topic": m.get("topic"),
            "title": m.get("title"),
            "tags": m.get("tags", []),
            "path": str(p.relative_to(root)),
        }
        if m.get("updated"):
            row["updated"] = m["updated"]
        if args.full:
            row["body"] = rec["body"]
            row["sources"] = m.get("sources", [])
        items.append(row)

    items.sort(key=lambda r: (r.get("when") or "", r.get("id") or ""), reverse=args.newest_first)
    if args.limit and args.limit > 0:
        items = items[: args.limit]
    print(json.dumps({"ok": True, "count": len(items), "episodes": items}, ensure_ascii=False, indent=2))


def cmd_topics(args: argparse.Namespace, root: Path) -> None:
    since_dt, until_dt = parse_range_bounds(args.since, args.until)
    by_topic: dict[str, dict[str, Any]] = {}
    for p in iter_episode_files(root, since_dt=since_dt, until_dt=until_dt):
        try:
            rec = parse_episode_file(p)
        except Exception:
            continue
        m = rec["meta"]
        when_val = str(m.get("when", ""))
        if not record_in_range(when_val, since_dt, until_dt):
            continue
        topic = str(m.get("topic", "general"))
        cur = by_topic.get(topic)
        if cur is None:
            by_topic[topic] = {
                "topic": topic,
                "count": 1,
                "latest_when": when_val,
                "latest_id": m.get("id"),
                "latest_title": m.get("title"),
            }
        else:
            cur["count"] += 1
            if when_val >= cur["latest_when"]:
                cur["latest_when"] = when_val
                cur["latest_id"] = m.get("id")
                cur["latest_title"] = m.get("title")
    rows = sorted(by_topic.values(), key=lambda r: r["latest_when"], reverse=True)
    print(json.dumps({"ok": True, "count": len(rows), "topics": rows}, ensure_ascii=False, indent=2))


def cmd_search(args: argparse.Namespace, root: Path) -> None:
    tokens = [t.lower() for t in re.findall(r"[A-Za-z0-9_-]+", args.query) if t]
    if not tokens:
        fail("Search query must contain at least one word")
    since_dt, until_dt = parse_range_bounds(args.since, args.until)
    hits = []
    for p in iter_episode_files(root, since_dt=since_dt, until_dt=until_dt):
        try:
            rec = parse_episode_file(p)
        except Exception:
            continue
        m = rec["meta"]
        when_val = str(m.get("when", ""))
        if not record_in_range(when_val, since_dt, until_dt):
            continue
        if args.topic and args.topic.lower() not in str(m.get("topic", "")).lower():
            continue
        if args.tag and args.tag.lower() not in [t.lower() for t in m.get("tags", [])]:
            continue
        haystack = " ".join([
            str(m.get("topic", "")),
            str(m.get("title", "")),
            " ".join(m.get("tags", [])),
            rec["body"],
        ]).lower()
        score = sum(haystack.count(tok) for tok in tokens)
        matched_tokens = sum(1 for tok in tokens if tok in haystack)
        if matched_tokens == 0:
            continue
        if args.all_terms and matched_tokens < len(tokens):
            continue
        hits.append({
            "score": matched_tokens * 100 + min(score, 99),
            "id": m.get("id"),
            "when": when_val,
            "kind": m.get("kind"),
            "topic": m.get("topic"),
            "title": m.get("title"),
            "tags": m.get("tags", []),
            "path": str(p.relative_to(root)),
            "snippet": rec["body"][:280] + ("..." if len(rec["body"]) > 280 else ""),
        })
    hits.sort(key=lambda h: (h["score"], h.get("when") or ""), reverse=True)
    if args.limit and args.limit > 0:
        hits = hits[: args.limit]
    print(json.dumps({"ok": True, "query": args.query, "count": len(hits), "hits": hits}, ensure_ascii=False, indent=2))


def cmd_update(args: argparse.Namespace, root: Path) -> None:
    payload: dict[str, Any] = {}
    if args.json:
        raw = sys.stdin.read()
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as e:
            fail(f"Invalid JSON on stdin: {e}")

    def pick(flag_val, key):
        return flag_val if flag_val is not None else payload.get(key)

    with write_lock(root):
        p = find_episode_by_id(root, args.id)
        if p is None:
            fail(f"Episode not found: {args.id}")
        rec = parse_episode_file(p)
        meta = rec["meta"]
        body = rec["body"]

        expected_updated = pick(args.expected_updated, "expected_updated")
        if expected_updated is not None and (meta.get("updated") or "") != expected_updated:
            fail(f"Conflict: expected updated={expected_updated!r}, found {meta.get('updated')!r}")

        title = pick(args.title, "title")
        if title is not None:
            title = str(title).strip()
            if not title or "\n" in title:
                fail("title must be a non-empty single line")
            check_secrets(title, "title")
            meta["title"] = title

        topic = pick(args.topic, "topic")
        if topic is not None:
            topic = str(topic).strip().lower()
            if not TOPIC_RE.match(topic):
                fail(f"Invalid topic {topic!r}")
            meta["topic"] = topic

        kind = pick(args.kind, "kind")
        if kind is not None:
            kind = str(kind).strip().lower()
            if kind not in VALID_KINDS:
                fail(f"Invalid kind {kind!r}")
            meta["kind"] = kind

        when_override = pick(args.when, "when")
        if when_override is not None:
            meta["when"] = parse_timestamp(str(when_override), default_now=False).isoformat()

        tags_replace = pick(args.tags, "tags")
        if tags_replace is not None:
            meta["tags"] = normalize_list(tags_replace)

        add_tags = pick(args.add_tag, "add_tags")
        if add_tags:
            existing = list(meta.get("tags", []))
            for t in normalize_list(add_tags):
                if t not in existing:
                    existing.append(t)
            meta["tags"] = existing

        remove_tags = pick(args.remove_tag, "remove_tags")
        if remove_tags:
            drop = {t.lower() for t in normalize_list(remove_tags)}
            meta["tags"] = [t for t in meta.get("tags", []) if t.lower() not in drop]

        sources_replace = pick(args.sources, "sources")
        if sources_replace is not None:
            sources = normalize_list(sources_replace)
            for s in sources:
                check_secrets(s, "sources")
            meta["sources"] = sources

        add_sources = pick(args.add_source, "add_sources")
        if add_sources:
            existing_s = list(meta.get("sources", []))
            for s in normalize_list(add_sources):
                check_secrets(s, "sources")
                if s not in existing_s:
                    existing_s.append(s)
            meta["sources"] = existing_s

        new_body = pick(args.body, "body")
        if new_body is not None:
            new_body = str(new_body).strip()
            check_secrets(new_body, "body")
            body = new_body

        append_text = pick(args.append, "append")
        if append_text is not None:
            append_text = str(append_text).strip()
            check_secrets(append_text, "append")
            if append_text:
                body = (body.rstrip() + "\n\n" + append_text).strip()

        meta["updated"] = now_local().isoformat()
        atomic_write(p, render_episode(meta, body))

    print(json.dumps({
        "ok": True,
        "id": meta["id"],
        "when": meta["when"],
        "updated": meta["updated"],
        "title": meta["title"],
        "tags": meta["tags"],
        "body_preview": body[:160] + ("..." if len(body) > 160 else ""),
        "path": str(p.relative_to(root)),
    }, ensure_ascii=False))


def cmd_delete(args: argparse.Namespace, root: Path) -> None:
    with write_lock(root):
        p = find_episode_by_id(root, args.id)
        if p is None:
            fail(f"Episode not found: {args.id}")
        if args.hard:
            p.unlink()
            print(json.dumps({"ok": True, "id": args.id, "action": "hard_deleted"}))
            return
        archive_dir = root / "memory" / "episodes" / ".archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        dest = archive_dir / p.name
        shutil.move(str(p), str(dest))
    print(json.dumps({
        "ok": True,
        "id": args.id,
        "action": "archived",
        "path": str(dest.relative_to(root)),
    }, ensure_ascii=False))


def cmd_restore(args: argparse.Namespace, root: Path) -> None:
    with write_lock(root):
        archive_path = root / "memory" / "episodes" / ".archive" / f"{args.id}.md"
        if not archive_path.exists():
            p = find_episode_by_id(root, args.id, include_archived=True)
            if p is None or ".archive" not in p.parts:
                fail(f"Archived episode not found: {args.id}")
            archive_path = p
        rec = parse_episode_file(archive_path)
        when_dt = parse_timestamp(rec["meta"].get("when"), default_now=True)
        dest = root / "memory" / "episodes" / when_dt.strftime("%Y-%m") / archive_path.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(archive_path), str(dest))
    print(json.dumps({
        "ok": True,
        "id": args.id,
        "action": "restored",
        "path": str(dest.relative_to(root)),
    }, ensure_ascii=False))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="thoth-mem", description="Thoth v2 episodic memory CRUD CLI")
    p.add_argument("--root", help="Instance root folder (defaults to THOTH_ROOT or current working directory)")
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("create", help="Create a new episode (prefer --json <<'EOF' to avoid shell escaping issues)")
    c.add_argument("--kind", choices=VALID_KINDS, default=None)
    c.add_argument("--topic", help="Lowercase topic slug (e.g. home/office-chair-shopping)")
    c.add_argument("--title", help="One-line summary title")
    c.add_argument("--body", help="Markdown body (or pipe via stdin)")
    c.add_argument("--when", help="Timestamp (YYYY-MM-DD, 'YYYY-MM-DD HH:MM', ISO-8601, or relative like 7d)")
    c.add_argument("--tags", help="Comma-separated tags")
    c.add_argument("--sources", help="Comma-separated source URLs/paths")
    c.add_argument("--id", help="Optional explicit ID")
    c.add_argument("--json", action="store_true", help="Read episode fields from JSON on stdin")

    r = sub.add_parser("read", help="Read one episode by ID")
    r.add_argument("id")
    r.add_argument("--md", action="store_true", help="Print raw Markdown file instead of JSON")
    r.add_argument("--archived", action="store_true", help="Also look in .archive/")

    ls = sub.add_parser("list", help="List episodes chronologically with optional filters and date ranges")
    ls.add_argument("--topic", help="Substring match on topic")
    ls.add_argument("--kind", choices=VALID_KINDS)
    ls.add_argument("--tag", help="Exact tag match")
    ls.add_argument("--since", help="Start bound: YYYY-MM-DD, ISO-8601, or relative (24h, 7d, 2w, 1m)")
    ls.add_argument("--until", help="End bound: YYYY-MM-DD (inclusive), ISO-8601, or relative (5d)")
    ls.add_argument("--limit", type=int, default=0)
    ls.add_argument("--newest-first", action="store_true")
    ls.add_argument("--full", action="store_true", help="Include full Markdown body and sources")
    ls.add_argument("--archived", action="store_true")

    tp = sub.add_parser("topics", help="Compact topic index (counts + latest timestamp/title)")
    tp.add_argument("--since", help="Optional start bound (date or relative like 30d)")
    tp.add_argument("--until", help="Optional end bound (date or relative)")

    s = sub.add_parser("search", help="Keyword search across episodes with optional date range")
    s.add_argument("query")
    s.add_argument("--topic", help="Optional topic substring filter")
    s.add_argument("--tag", help="Optional exact tag filter")
    s.add_argument("--since", help="Start bound: YYYY-MM-DD, ISO-8601, or relative (24h, 7d, 2w, 1m)")
    s.add_argument("--until", help="End bound: YYYY-MM-DD (inclusive), ISO-8601, or relative")
    s.add_argument("--all-terms", action="store_true", help="Require all query terms to match")
    s.add_argument("--limit", type=int, default=15)

    u = sub.add_parser("update", help="Update an existing episode by ID (preserves 'when', stamps 'updated')")
    u.add_argument("id")
    u.add_argument("--title")
    u.add_argument("--topic")
    u.add_argument("--kind", choices=VALID_KINDS)
    u.add_argument("--when", help="Explicitly fix occurrence timestamp (rare)")
    u.add_argument("--tags", help="Replace tags (comma-separated)")
    u.add_argument("--add-tag", help="Append tag(s) (comma-separated)")
    u.add_argument("--remove-tag", help="Remove tag(s) (comma-separated)")
    u.add_argument("--sources", help="Replace sources (comma-separated)")
    u.add_argument("--add-source", help="Append source(s) (comma-separated)")
    u.add_argument("--body", help="Replace Markdown body")
    u.add_argument("--append", help="Append text to Markdown body")
    u.add_argument("--expected-updated", help="Optimistic concurrency check against current 'updated' value")
    u.add_argument("--json", action="store_true", help="Read update fields from JSON on stdin")

    d = sub.add_parser("delete", help="Archive (soft-delete) an episode by ID")
    d.add_argument("id")
    d.add_argument("--hard", action="store_true", help="Permanently delete instead of archiving")

    rs = sub.add_parser("restore", help="Restore an archived episode back to memory/episodes/YYYY-MM/")
    rs.add_argument("id")
    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    root = resolve_root(args.root)
    dispatch = {
        "create": cmd_create,
        "read": cmd_read,
        "list": cmd_list,
        "topics": cmd_topics,
        "search": cmd_search,
        "update": cmd_update,
        "delete": cmd_delete,
        "restore": cmd_restore,
    }
    dispatch[args.cmd](args, root)


if __name__ == "__main__":
    main()
