#!/usr/bin/env python3
"""Thoth health-tracker CLI (`health-track`).

Design:
- Monthly append-friendly JSONL logs:
      <root>/health/logs/YYYY-MM.jsonl
  Soft-deleted entries move to:
      <root>/health/logs/.archive/YYYY-MM.jsonl
- Recurring foods catalog (fixed estimated kcal/protein):
      <root>/health/staples.json
- Instance baseline, targets, and optional Google Sheet mirror metadata (zero PII in engine):
      <root>/health/config.json
- Typed entries (`meal`, `weight`, `cpap`, `med`, `workout`, `slip`) with
  stable IDs (`h-YYYYMMDD-HHMMSS-<4hex>`), revisions, and strict `--json`
  validation.
- Same storage guarantees as thoth-mem / todo-list: OS file lock on
  <root>/health/.write.lock, atomic writes, secret scanning, stdlib only.
"""

from __future__ import annotations

import argparse
import json
import re
import secrets
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from thoth_core import (
    atomic_write,
    check_secrets,
    fail,
    normalize_list,
    now_local,
    paginate,
    read_json_stdin,
    resolve_root,
    validate_json_keys,
    write_lock,
)
from health_track.report import render_weekly_html
from health_track.sync import (
    build_sync_plan,
    extract_remote_rows,
    load_sync_state,
    normalize_row,
    row_key,
    row_to_entry_payload,
    row_to_staple_payload,
    save_sync_state,
    sync_state_path,
)

PROG = "health-track"

ENTRY_TYPES = ("meal", "weight", "cpap", "med", "workout", "slip")
MEAL_SLOTS = ("breakfast", "lunch", "dinner", "snack", "drink")
CPAP_REFRESHED = ("yes", "somewhat", "no")
MED_STATUSES = ("taken", "missed", "partial", "skipped")
WORKOUT_KINDS = ("trainer", "solo")
WORKOUT_STATUSES = ("attended", "missed", "missed_and_paid")

ID_RE = re.compile(r"^h-\d{8}-\d{6}-[0-9a-f]{4}$")
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
YM_FILE_RE = re.compile(r"^\d{4}-\d{2}\.jsonl$")
DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REL_DURATION_RE = re.compile(r"^(\d+)\s*(h|d|w|mo|m)$", re.IGNORECASE)

COMMON_ADD_KEYS = frozenset({"type", "when", "notes"})
COMMON_FIX_KEYS = frozenset({"when", "notes", "expected_revision"})

TYPE_KEYS: dict[str, frozenset[str]] = {
    "meal": frozenset({"slot", "items", "kcal", "protein_g", "estimated", "description", "tags"}),
    "weight": frozenset({"weight_kg", "waist_in", "context"}),
    "cpap": frozenset({"hours", "ahi", "mask_offs", "leak_lpm", "refreshed"}),
    "med": frozenset({"name", "dose", "status", "timing"}),
    "workout": frozenset({"kind", "status", "duration_min", "exercises", "fasted"}),
    "slip": frozenset({"what", "trigger", "kcal_est", "protein_g_est"}),
}

MEAL_ITEM_KEYS = frozenset({"staple", "name", "unit", "qty", "kcal", "protein_g", "estimated"})
STAPLE_ADD_KEYS = frozenset({"slug", "name", "unit", "kcal", "protein_g", "estimated", "aliases", "notes"})
STAPLE_FIX_KEYS = frozenset({"name", "unit", "kcal", "protein_g", "estimated", "aliases", "notes"})
CONFIG_KEYS = frozenset({"baseline", "targets", "sheets"})
BASELINE_KEYS = frozenset({"weight_kg", "waist_in", "date"})
TARGET_KEYS = frozenset({"protein_g_min", "kcal_max", "cpap_hours_min", "cpap_ahi_max", "meds"})
MED_TARGET_KEYS = frozenset({"name", "dose", "expected_per_day"})
SHEETS_KEYS = frozenset({"spreadsheet_id", "title", "url", "permission_rule_id"})

SHEET_HEADERS: dict[str, list[str]] = {
    "Workouts": ["Date", "Kind", "Status", "Duration (min)", "Exercises", "Fasted", "Notes", "ID"],
    "Meals": ["Date", "Time", "Slot", "Description", "Kcal (est)", "Protein g (est)", "Notes", "ID"],
    "Weight": ["Date", "Time", "Weight (kg)", "Waist (in)", "Context", "Notes", "ID"],
    "CPAP": ["Date", "Hours", "AHI", "Mask-offs", "Refreshed", "Notes", "ID"],
    "Meds": ["Date", "Time", "Name", "Dose", "Status", "Timing", "Notes", "ID"],
    "Slips": ["Date", "Time", "What", "Trigger", "Kcal (est)", "Notes", "ID"],
    "Staples": ["Slug", "Name", "Unit", "Kcal (est)", "Protein g (est)", "Aliases", "Notes"],
}


# ---------------------------------------------------------------- paths

def health_dir(root: Path) -> Path:
    return root / "health"


def logs_dir(root: Path) -> Path:
    return health_dir(root) / "logs"


def archive_dir(root: Path) -> Path:
    return logs_dir(root) / ".archive"


def staples_path(root: Path) -> Path:
    return health_dir(root) / "staples.json"


def config_path(root: Path) -> Path:
    return health_dir(root) / "config.json"


def rel(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


# ---------------------------------------------------------------- timestamps & parsing

def parse_timestamp(raw: str | None, *, default_now: bool = True) -> datetime:
    cur = now_local()
    if not raw:
        if default_now:
            return cur
        fail("Timestamp is required")
    s = str(raw).strip()
    if m := REL_DURATION_RE.match(s):
        qty = int(m.group(1))
        unit = m.group(2).lower()
        if unit == "m":
            fail(f"Ambiguous relative duration {s!r}; use 'mo' for months or 'h'/'d'/'w' for hours/days/weeks")
        mult = {"h": timedelta(hours=1), "d": timedelta(days=1), "w": timedelta(weeks=1), "mo": timedelta(days=30)}[unit]
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
        fail(f"Invalid timestamp {s!r}; use YYYY-MM-DD, 'YYYY-MM-DD HH:MM', ISO-8601, or relative (24h, 7d, 2w, 1mo)")
        raise


def parse_range_bounds(since: str | None, until: str | None) -> tuple[datetime | None, datetime | None]:
    since_dt = parse_timestamp(since, default_now=False) if since else None
    until_dt = None
    if until:
        raw = until.strip()
        if DATE_ONLY_RE.match(raw):
            until_dt = parse_timestamp(f"{raw} 23:59:59", default_now=False)
        else:
            until_dt = parse_timestamp(raw, default_now=False)
    if since_dt and until_dt and since_dt > until_dt:
        fail(f"--since ({since}) must be on or before --until ({until})")
    return since_dt, until_dt


def parse_date_only(raw: str, field: str) -> date:
    s = str(raw or "").strip()
    if not DATE_ONLY_RE.match(s):
        fail(f"Invalid {field} {raw!r}; expected YYYY-MM-DD")
    try:
        return date.fromisoformat(s)
    except ValueError:
        fail(f"Invalid {field} {raw!r}; not a real calendar date")
        raise


def round1(val: float) -> float:
    return round(float(val), 1)


def set_or_pop(d: dict[str, Any], key: str, value: Any) -> None:
    """Store value under key, or remove key when value is None or empty."""
    if value is None or value == "":
        d.pop(key, None)
    else:
        d[key] = value


def num_or_none(val: Any, field: str, *, min_val: float | None = None, max_val: float | None = None) -> float | None:
    if val is None or val == "":
        return None
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        fail(f"{field} must be a number, got {val!r}")
    f = float(val)
    if min_val is not None and f < min_val:
        fail(f"{field} must be >= {min_val}, got {f}")
    if max_val is not None and f > max_val:
        fail(f"{field} must be <= {max_val}, got {f}")
    return f


def int_or_none(val: Any, field: str, *, min_val: int | None = None) -> int | None:
    if val is None or val == "":
        return None
    if isinstance(val, bool) or not isinstance(val, int):
        fail(f"{field} must be an integer, got {val!r}")
    if min_val is not None and val < min_val:
        fail(f"{field} must be >= {min_val}, got {val}")
    return val


def bool_or_none(val: Any, field: str) -> bool | None:
    if val is None or val == "":
        return None
    if not isinstance(val, bool):
        fail(f"{field} must be a boolean, got {val!r}")
    return val


def clean_text(val: Any, field: str, *, required: bool = False, single_line: bool = False) -> str:
    if val is None:
        text = ""
    else:
        text = str(val).strip()
    if required and not text:
        fail(f"{field} is required")
    if single_line and ("\n" in text or "\r" in text):
        fail(f"{field} must be a single line")
    check_secrets(text, field)
    return text


def clean_choice(val: Any, choices: tuple[str, ...], field: str, *, required: bool = False) -> str:
    if val is None or str(val).strip() == "":
        if required:
            fail(f"{field} is required; expected one of: {', '.join(choices)}")
        return ""
    v = str(val).strip().lower()
    if v not in choices:
        fail(f"Invalid {field} {val!r}; expected one of: {', '.join(choices)}")
    return v


def clean_slug(val: Any, field: str = "slug") -> str:
    s = str(val or "").strip().lower()
    if not s or not SLUG_RE.match(s):
        fail(f"Invalid {field} {val!r}; use lowercase kebab-case like 'egg-large'")
    check_secrets(s, field)
    return s


# ---------------------------------------------------------------- config & staples storage

def load_json_file(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return json.loads(json.dumps(default))
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        fail(f"Unreadable JSON file {path.name}: {e}")
    if not isinstance(data, dict):
        fail(f"Expected JSON object in {path.name}")
    return data


def load_staples(root: Path) -> dict[str, Any]:
    data = load_json_file(
        staples_path(root),
        {
            "version": 1,
            "note": "All nutrition values are estimates for consistent tracking.",
            "staples": {},
        },
    )
    staples = data.get("staples")
    if not isinstance(staples, dict):
        fail("staples.json: 'staples' must be a JSON object")
    return data


def save_staples(root: Path, data: dict[str, Any]) -> None:
    atomic_write(staples_path(root), json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def load_config(root: Path) -> dict[str, Any]:
    return load_json_file(config_path(root), {"version": 1, "baseline": {}, "targets": {}})


def save_config(root: Path, data: dict[str, Any]) -> None:
    atomic_write(config_path(root), json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def find_staple(staples_map: dict[str, dict[str, Any]], query: str) -> tuple[str, dict[str, Any]] | None:
    q = query.strip().lower()
    if q in staples_map:
        return q, staples_map[q]
    for slug, info in staples_map.items():
        aliases = [str(a).strip().lower() for a in info.get("aliases", [])]
        if q in aliases or q == str(info.get("name", "")).strip().lower():
            return slug, info
    return None


# ---------------------------------------------------------------- JSONL storage

def iter_log_files(
    root: Path,
    *,
    include_archived: bool = False,
    since_ym: str | None = None,
    until_ym: str | None = None,
) -> list[tuple[Path, bool]]:
    folders: list[tuple[Path, bool]] = [(logs_dir(root), False)]
    if include_archived:
        folders.append((archive_dir(root), True))
    out: list[tuple[Path, bool]] = []
    for folder, archived in folders:
        if not folder.exists():
            continue
        for p in sorted(folder.glob("*.jsonl")):
            if not YM_FILE_RE.match(p.name):
                continue
            ym = p.stem
            if since_ym and ym < since_ym:
                continue
            if until_ym and ym > until_ym:
                continue
            out.append((p, archived))
    return out


def parse_jsonl_file(root: Path, path: Path, archived: bool) -> tuple[list[dict[str, Any]], list[str]]:
    entries: list[dict[str, Any]] = []
    errors: list[str] = []
    if not path.exists():
        return entries, errors
    for lineno, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
            if not isinstance(obj, dict):
                raise ValueError("line is not a JSON object")
            for req in ("id", "type", "when", "date"):
                if not obj.get(req):
                    raise ValueError(f"missing required field {req!r}")
            if obj["type"] not in ENTRY_TYPES:
                raise ValueError(f"unknown entry type {obj['type']!r}")
            entries.append({"entry": obj, "path": path, "archived": archived})
        except Exception as e:  # noqa: BLE001
            errors.append(f"{rel(root, path)}:{lineno}: {e}")
    return entries, errors


def load_entries(
    root: Path,
    *,
    include_archived: bool = False,
    since_ym: str | None = None,
    until_ym: str | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    records: list[dict[str, Any]] = []
    errors: list[str] = []
    for path, archived in iter_log_files(root, include_archived=include_archived, since_ym=since_ym, until_ym=until_ym):
        ents, errs = parse_jsonl_file(root, path, archived)
        records.extend(ents)
        errors.extend(errs)
    return records, errors


def load_entries_for_write(root: Path, *, include_archived: bool = True) -> list[dict[str, Any]]:
    records, errors = load_entries(root, include_archived=include_archived)
    if errors:
        fail("Refusing to write while health log files have unreadable lines; fix them first: " + "; ".join(errors))
    return records


def write_jsonl_file(path: Path, entries: list[dict[str, Any]]) -> None:
    if not entries:
        if path.exists():
            path.unlink()
        return
    ordered = sorted(entries, key=lambda e: (e.get("when", ""), e.get("id", "")))
    text = "".join(json.dumps(e, ensure_ascii=False) + "\n" for e in ordered)
    atomic_write(path, text)


def allocate_id(when_dt: datetime, existing_ids: set[str]) -> str:
    stamp = when_dt.strftime("%Y%m%d-%H%M%S")
    for _ in range(64):
        cand = f"h-{stamp}-{secrets.token_hex(2)}"
        if cand not in existing_ids:
            return cand
    fail("Could not allocate unique health entry id")
    raise RuntimeError


# ---------------------------------------------------------------- per-type validation

def resolve_meal_items(raw_items: Any, staples_map: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(raw_items, list) or not raw_items:
        fail("meal 'items' must be a non-empty JSON list")
    out: list[dict[str, Any]] = []
    for idx, raw in enumerate(raw_items):
        if not isinstance(raw, dict):
            fail(f"meal items[{idx}] must be a JSON object")
        validate_json_keys(raw, MEAL_ITEM_KEYS, f"meal items[{idx}]")
        qty = num_or_none(raw.get("qty", 1), f"items[{idx}].qty", min_val=0.01)
        assert qty is not None
        if raw.get("staple"):
            query = str(raw["staple"]).strip()
            found = find_staple(staples_map, query)
            if found is None:
                avail = ", ".join(sorted(staples_map)) or "(none configured)"
                fail(f"Unknown staple {query!r} in items[{idx}]. Available staples: {avail}")
            slug, info = found
            kcal = round1(float(info["kcal"]) * qty)
            protein_g = round1(float(info["protein_g"]) * qty)
            est = bool(info.get("estimated", True))
            if "estimated" in raw:
                est = bool(bool_or_none(raw["estimated"], f"items[{idx}].estimated"))
            out.append({
                "staple": slug,
                "name": info["name"],
                "unit": info["unit"],
                "qty": qty,
                "kcal": kcal,
                "protein_g": protein_g,
                "estimated": est,
            })
        else:
            name = clean_text(raw.get("name"), f"items[{idx}].name", required=True, single_line=True)
            unit = clean_text(raw.get("unit") or "serving", f"items[{idx}].unit", single_line=True)
            kcal = num_or_none(raw.get("kcal"), f"items[{idx}].kcal", min_val=0)
            protein_g = num_or_none(raw.get("protein_g"), f"items[{idx}].protein_g", min_val=0)
            if kcal is None or protein_g is None:
                fail(f"Custom meal item {name!r} requires numeric 'kcal' and 'protein_g'")
            est = True if "estimated" not in raw else bool(bool_or_none(raw["estimated"], f"items[{idx}].estimated"))
            out.append({
                "name": name,
                "unit": unit,
                "qty": qty,
                "kcal": round1(kcal),
                "protein_g": round1(protein_g),
                "estimated": est,
            })
    return out


def format_items_description(items: list[dict[str, Any]]) -> str:
    parts = []
    for it in items:
        qty = it["qty"]
        qty_s = str(int(qty)) if float(qty).is_integer() else str(qty)
        parts.append(f"{qty_s}x {it['name']}")
    return ", ".join(parts)


def validate_entry_fields(
    entry_type: str,
    raw: dict[str, Any],
    staples_map: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if entry_type == "meal":
        slot = clean_choice(raw.get("slot"), MEAL_SLOTS, "slot")
        if slot:
            out["slot"] = slot
        items_raw = raw.get("items")
        if items_raw is not None:
            items = resolve_meal_items(items_raw, staples_map)
            out["items"] = items
            calc_kcal = round1(sum(it["kcal"] for it in items))
            calc_prot = round1(sum(it["protein_g"] for it in items))
            kcal = num_or_none(raw.get("kcal"), "kcal", min_val=0)
            protein_g = num_or_none(raw.get("protein_g"), "protein_g", min_val=0)
            out["kcal"] = round1(kcal) if kcal is not None else calc_kcal
            out["protein_g"] = round1(protein_g) if protein_g is not None else calc_prot
            default_est = any(it.get("estimated", True) for it in items)
            out["estimated"] = default_est if "estimated" not in raw else bool(bool_or_none(raw["estimated"], "estimated"))
            desc = clean_text(raw.get("description"), "description", single_line=True)
            out["description"] = desc or format_items_description(items)
        else:
            kcal = num_or_none(raw.get("kcal"), "kcal", min_val=0)
            protein_g = num_or_none(raw.get("protein_g"), "protein_g", min_val=0)
            if kcal is None or protein_g is None:
                fail("meal requires 'items' or both numeric 'kcal' and 'protein_g'")
            desc = clean_text(raw.get("description"), "description", required=True, single_line=True)
            out["description"] = desc
            out["kcal"] = round1(kcal)
            out["protein_g"] = round1(protein_g)
            out["estimated"] = True if "estimated" not in raw else bool(bool_or_none(raw["estimated"], "estimated"))
        tags = [clean_slug(t, "tags") for t in normalize_list(raw.get("tags"))]
        if tags:
            out["tags"] = sorted(set(tags))

    elif entry_type == "weight":
        weight_kg = num_or_none(raw.get("weight_kg"), "weight_kg", min_val=20, max_val=400)
        waist_in = num_or_none(raw.get("waist_in"), "waist_in", min_val=15, max_val=100)
        if weight_kg is None and waist_in is None:
            fail("weight entry requires at least one of 'weight_kg' or 'waist_in'")
        if weight_kg is not None:
            out["weight_kg"] = round1(weight_kg)
        if waist_in is not None:
            out["waist_in"] = round1(waist_in)
        ctx = clean_text(raw.get("context"), "context", single_line=True)
        if ctx:
            out["context"] = ctx

    elif entry_type == "cpap":
        hours = num_or_none(raw.get("hours"), "hours", min_val=0, max_val=24)
        if hours is None:
            fail("cpap entry requires numeric 'hours'")
        out["hours"] = round1(hours)
        ahi = num_or_none(raw.get("ahi"), "ahi", min_val=0, max_val=200)
        if ahi is not None:
            out["ahi"] = round1(ahi)
        mask_offs = int_or_none(raw.get("mask_offs"), "mask_offs", min_val=0)
        if mask_offs is not None:
            out["mask_offs"] = mask_offs
        leak_lpm = num_or_none(raw.get("leak_lpm"), "leak_lpm", min_val=0, max_val=200)
        if leak_lpm is not None:
            out["leak_lpm"] = round1(leak_lpm)
        refreshed = clean_choice(raw.get("refreshed"), CPAP_REFRESHED, "refreshed")
        if refreshed:
            out["refreshed"] = refreshed

    elif entry_type == "med":
        name = clean_text(raw.get("name"), "name", required=True, single_line=True).lower()
        out["name"] = name
        dose = clean_text(raw.get("dose"), "dose", single_line=True)
        if dose:
            out["dose"] = dose
        out["status"] = clean_choice(raw.get("status") or "taken", MED_STATUSES, "status", required=True)
        timing = clean_text(raw.get("timing"), "timing", single_line=True)
        if timing:
            out["timing"] = timing

    elif entry_type == "workout":
        out["kind"] = clean_choice(raw.get("kind") or "solo", WORKOUT_KINDS, "kind", required=True)
        out["status"] = clean_choice(raw.get("status") or "attended", WORKOUT_STATUSES, "status", required=True)
        dur = num_or_none(raw.get("duration_min"), "duration_min", min_val=1, max_val=600)
        if dur is not None:
            out["duration_min"] = int(dur) if float(dur).is_integer() else round1(dur)
        ex = int_or_none(raw.get("exercises"), "exercises", min_val=0)
        if ex is not None:
            out["exercises"] = ex
        fasted = bool_or_none(raw.get("fasted"), "fasted")
        if fasted is not None:
            out["fasted"] = fasted

    elif entry_type == "slip":
        out["what"] = clean_text(raw.get("what"), "what", required=True, single_line=True)
        out["trigger"] = clean_text(raw.get("trigger"), "trigger", required=True, single_line=True).lower()
        kcal_est = num_or_none(raw.get("kcal_est"), "kcal_est", min_val=0)
        if kcal_est is not None:
            out["kcal_est"] = round1(kcal_est)
        prot_est = num_or_none(raw.get("protein_g_est"), "protein_g_est", min_val=0)
        if prot_est is not None:
            out["protein_g_est"] = round1(prot_est)

    return out


# ---------------------------------------------------------------- summary builder

def build_summary(root: Path, since_date: date, until_date: date) -> dict[str, Any]:
    if since_date > until_date:
        fail(f"since ({since_date.isoformat()}) must be on or before until ({until_date.isoformat()})")
    since_ym = since_date.strftime("%Y-%m")
    until_ym = until_date.strftime("%Y-%m")
    records, warnings = load_entries(root, include_archived=False, since_ym=since_ym, until_ym=until_ym)
    cfg = load_config(root)
    baseline = cfg.get("baseline") or {}
    targets = cfg.get("targets") or {}

    all_days: list[str] = []
    d = since_date
    while d <= until_date:
        all_days.append(d.isoformat())
        d += timedelta(days=1)

    in_window: list[dict[str, Any]] = []
    for rec in records:
        e = rec["entry"]
        edate = str(e.get("date", ""))
        if since_date.isoformat() <= edate <= until_date.isoformat():
            in_window.append(e)
    in_window.sort(key=lambda e: (e["when"], e["id"]))

    # Group by day
    by_day: dict[str, list[dict[str, Any]]] = {ds: [] for ds in all_days}
    for e in in_window:
        if e["date"] in by_day:
            by_day[e["date"]].append(e)

    # Configured meds + any logged meds
    tracked_meds: list[dict[str, Any]] = []
    seen_meds: set[str] = set()
    for m in targets.get("meds", []):
        if isinstance(m, dict) and m.get("name"):
            nm = str(m["name"]).strip().lower()
            if nm not in seen_meds:
                seen_meds.add(nm)
                tracked_meds.append({
                    "name": nm,
                    "dose": m.get("dose") or "",
                    "expected_per_day": m.get("expected_per_day", 1),
                })
    for e in in_window:
        if e["type"] == "med":
            nm = str(e["name"]).strip().lower()
            if nm not in seen_meds:
                seen_meds.add(nm)
                tracked_meds.append({"name": nm, "dose": e.get("dose") or "", "expected_per_day": 1})

    protein_target = targets.get("protein_g_min")
    kcal_max = targets.get("kcal_max")
    cpap_hours_min = targets.get("cpap_hours_min", 6.0)
    cpap_ahi_max = targets.get("cpap_ahi_max", 5.0)

    daily_rows: list[dict[str, Any]] = []
    weight_points: list[dict[str, Any]] = []
    waist_points: list[dict[str, Any]] = []
    cpap_nights: list[dict[str, Any]] = []
    slips_list: list[dict[str, Any]] = []
    trigger_counts: dict[str, int] = {}
    workout_counts = {"attended": 0, "missed": 0, "missed_and_paid": 0, "trainer": 0, "solo": 0}
    med_totals: dict[str, dict[str, Any]] = {
        m["name"]: {"name": m["name"], "dose": m["dose"], "days_taken": 0, "days_partial": 0, "days_missed": 0, "days_unknown": 0}
        for m in tracked_meds
    }

    meal_days_logged = 0
    protein_days_hit = 0
    protein_sum = 0.0
    kcal_sum = 0.0

    for ds in all_days:
        ents = by_day[ds]
        meals = [e for e in ents if e["type"] == "meal"]
        weights = [e for e in ents if e["type"] == "weight"]
        cpaps = [e for e in ents if e["type"] == "cpap"]
        meds = [e for e in ents if e["type"] == "med"]
        workouts = [e for e in ents if e["type"] == "workout"]
        slips = [e for e in ents if e["type"] == "slip"]

        # Meals (missing day => None, NEVER 0)
        if meals:
            day_kcal = round1(sum(float(m["kcal"]) for m in meals))
            day_prot = round1(sum(float(m["protein_g"]) for m in meals))
            day_est = any(m.get("estimated", True) for m in meals)
            meal_days_logged += 1
            kcal_sum += day_kcal
            protein_sum += day_prot
            hit_prot: bool | None = None
            if protein_target is not None:
                hit_prot = day_prot >= float(protein_target)
                if hit_prot:
                    protein_days_hit += 1
        else:
            day_kcal = None
            day_prot = None
            day_est = None
            hit_prot = None

        # Weight / waist (latest reading of the day if multiple)
        w_vals = [e["weight_kg"] for e in weights if "weight_kg" in e]
        waist_vals = [e["waist_in"] for e in weights if "waist_in" in e]
        day_weight = w_vals[-1] if w_vals else None
        day_waist = waist_vals[-1] if waist_vals else None
        if day_weight is not None:
            weight_points.append({"date": ds, "weight_kg": day_weight})
        if day_waist is not None:
            waist_points.append({"date": ds, "waist_in": day_waist})

        # CPAP (latest reading for that wake-up date if multiple)
        if cpaps:
            c = cpaps[-1]
            cpap_obj: dict[str, Any] | None = {
                "date": ds,
                "hours": c["hours"],
                "ahi": c.get("ahi"),
                "mask_offs": c.get("mask_offs"),
                "refreshed": c.get("refreshed"),
                "notes": c.get("notes", ""),
            }
            cpap_nights.append(cpap_obj)
        else:
            cpap_obj = None

        # Meds per day
        day_meds: dict[str, str | None] = {}
        for m in tracked_meds:
            nm = m["name"]
            m_ents = [e for e in meds if e["name"] == nm]
            if not m_ents:
                day_meds[nm] = None
                med_totals[nm]["days_unknown"] += 1
            else:
                statuses = {e["status"] for e in m_ents}
                if "taken" in statuses and not (statuses & {"missed", "skipped", "partial"}):
                    day_meds[nm] = "taken"
                    med_totals[nm]["days_taken"] += 1
                elif "partial" in statuses or ("taken" in statuses and (statuses & {"missed", "skipped"})):
                    day_meds[nm] = "partial"
                    med_totals[nm]["days_partial"] += 1
                else:
                    day_meds[nm] = "missed"
                    med_totals[nm]["days_missed"] += 1

        # Workouts
        for wk in workouts:
            workout_counts[wk["status"]] += 1
            workout_counts[wk["kind"]] += 1

        # Slips
        for sl in slips:
            trig = sl["trigger"]
            trigger_counts[trig] = trigger_counts.get(trig, 0) + 1
            slips_list.append({
                "id": sl["id"],
                "date": ds,
                "when": sl["when"],
                "what": sl["what"],
                "trigger": trig,
                "kcal_est": sl.get("kcal_est"),
                "notes": sl.get("notes", ""),
            })

        daily_rows.append({
            "date": ds,
            "meal_count": len(meals),
            "kcal": day_kcal,
            "protein_g": day_prot,
            "nutrition_estimated": day_est,
            "hit_protein_target": hit_prot,
            "weight_kg": day_weight,
            "waist_in": day_waist,
            "cpap": cpap_obj,
            "meds": day_meds,
            "workouts": [
                {
                    "id": w["id"],
                    "kind": w["kind"],
                    "status": w["status"],
                    "duration_min": w.get("duration_min"),
                    "exercises": w.get("exercises"),
                    "notes": w.get("notes", ""),
                }
                for w in workouts
            ],
            "slip_count": len(slips),
        })

    # Weight & waist vs baseline
    base_weight = baseline.get("weight_kg")
    base_waist = baseline.get("waist_in")
    latest_weight = weight_points[-1]["weight_kg"] if weight_points else None
    latest_waist = waist_points[-1]["waist_in"] if waist_points else None

    cpap_hours_vals = [n["hours"] for n in cpap_nights]
    cpap_ahi_vals = [n["ahi"] for n in cpap_nights if n.get("ahi") is not None]

    total_days = len(all_days)
    summary: dict[str, Any] = {
        "since": since_date.isoformat(),
        "until": until_date.isoformat(),
        "total_days": total_days,
        "entry_count": len(in_window),
        "baseline": baseline,
        "targets": {
            "protein_g_min": protein_target,
            "kcal_max": kcal_max,
            "cpap_hours_min": cpap_hours_min,
            "cpap_ahi_max": cpap_ahi_max,
            "meds": tracked_meds,
        },
        "weight": {
            "baseline_kg": base_weight,
            "latest_kg": latest_weight,
            "delta_vs_baseline_kg": round1(latest_weight - float(base_weight)) if (latest_weight is not None and base_weight is not None) else None,
            "min_kg": min((p["weight_kg"] for p in weight_points), default=None),
            "max_kg": max((p["weight_kg"] for p in weight_points), default=None),
            "days_logged": len(weight_points),
            "days_unknown": total_days - len(weight_points),
        },
        "waist": {
            "baseline_in": base_waist,
            "latest_in": latest_waist,
            "delta_vs_baseline_in": round1(latest_waist - float(base_waist)) if (latest_waist is not None and base_waist is not None) else None,
            "days_logged": len(waist_points),
            "days_unknown": total_days - len(waist_points),
        },
        "nutrition": {
            "days_logged": meal_days_logged,
            "days_unknown": total_days - meal_days_logged,
            "avg_kcal_logged_days": round1(kcal_sum / meal_days_logged) if meal_days_logged else None,
            "avg_protein_g_logged_days": round1(protein_sum / meal_days_logged) if meal_days_logged else None,
            "protein_target_g": protein_target,
            "protein_days_hit": protein_days_hit if protein_target is not None else None,
            "protein_hit_rate": round(protein_days_hit / meal_days_logged, 3) if (protein_target is not None and meal_days_logged) else None,
            "estimated": True,
        },
        "cpap": {
            "nights_logged": len(cpap_nights),
            "nights_unknown": total_days - len(cpap_nights),
            "avg_hours": round1(sum(cpap_hours_vals) / len(cpap_hours_vals)) if cpap_hours_vals else None,
            "avg_ahi": round1(sum(cpap_ahi_vals) / len(cpap_ahi_vals)) if cpap_ahi_vals else None,
            "nights_meeting_hours": sum(1 for h in cpap_hours_vals if h >= float(cpap_hours_min)) if cpap_hours_vals else 0,
            "nights_controlled_ahi": sum(1 for a in cpap_ahi_vals if a < float(cpap_ahi_max)) if cpap_ahi_vals else 0,
        },
        "meds": list(med_totals.values()),
        "workouts": workout_counts,
        "slips": {
            "count": len(slips_list),
            "by_trigger": dict(sorted(trigger_counts.items(), key=lambda kv: (-kv[1], kv[0]))),
            "items": slips_list,
        },
        "days": daily_rows,
    }
    if warnings:
        summary["warnings"] = warnings
    return summary


def entry_to_sheet_row(entry: dict[str, Any]) -> tuple[str, list[Any]]:
    etype = entry["type"]
    t_part = str(entry["when"])[11:16] if len(str(entry["when"])) >= 16 else ""
    notes = entry.get("notes", "")
    eid = entry["id"]
    if etype == "workout":
        fasted = entry.get("fasted")
        fasted_s = "Yes" if fasted is True else ("No" if fasted is False else "")
        return "Workouts", [
            entry["date"],
            entry["kind"],
            entry["status"],
            entry.get("duration_min", ""),
            entry.get("exercises", ""),
            fasted_s,
            notes,
            eid,
        ]
    if etype == "meal":
        return "Meals", [
            entry["date"],
            t_part,
            entry.get("slot", ""),
            entry.get("description", ""),
            entry["kcal"],
            entry["protein_g"],
            notes,
            eid,
        ]
    if etype == "weight":
        return "Weight", [
            entry["date"],
            t_part,
            entry.get("weight_kg", ""),
            entry.get("waist_in", ""),
            entry.get("context", ""),
            notes,
            eid,
        ]
    if etype == "cpap":
        return "CPAP", [
            entry["date"],
            entry["hours"],
            entry.get("ahi", ""),
            entry.get("mask_offs", ""),
            entry.get("refreshed", ""),
            notes,
            eid,
        ]
    if etype == "med":
        return "Meds", [
            entry["date"],
            t_part,
            entry["name"],
            entry.get("dose", ""),
            entry["status"],
            entry.get("timing", ""),
            notes,
            eid,
        ]
    if etype == "slip":
        return "Slips", [
            entry["date"],
            t_part,
            entry["what"],
            entry["trigger"],
            entry.get("kcal_est", ""),
            notes,
            eid,
        ]
    fail(f"Unsupported entry type for sheet row: {etype!r}")
    raise RuntimeError


def compute_workout_counts(entries: list[dict[str, Any]], *, kind: str = "trainer") -> dict[str, Any]:
    workouts = [
        e for e in entries
        if e["type"] == "workout" and (kind == "all" or e["kind"] == kind)
    ]
    workouts.sort(key=lambda e: (e["date"], e["when"], e["id"]))
    attended = sum(1 for w in workouts if w["status"] == "attended")
    missed_and_paid = sum(1 for w in workouts if w["status"] == "missed_and_paid")
    missed = sum(1 for w in workouts if w["status"] == "missed")
    return {
        "kind": kind,
        "total": len(workouts),
        "attended": attended,
        "missed_and_paid": missed_and_paid,
        "missed": missed,
        "billable": attended + missed_and_paid,
        "sessions": [
            {
                "id": w["id"],
                "date": w["date"],
                "kind": w["kind"],
                "status": w["status"],
                **({"duration_min": w["duration_min"]} if "duration_min" in w else {}),
                **({"exercises": w["exercises"]} if "exercises" in w else {}),
                **({"notes": w["notes"]} if w.get("notes") else {}),
            }
            for w in workouts
        ],
    }


# ---------------------------------------------------------------- entry commands

def cmd_add(args: argparse.Namespace, root: Path) -> None:
    payload: dict[str, Any] = {}
    if args.json:
        raw_text = sys.stdin.read()
        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError as e:
            fail(f"Invalid JSON on stdin: {e}")
        if not isinstance(parsed, dict):
            fail("add --json expects a JSON object")
        payload = parsed

    entry_type = args.entry_type or payload.get("type")
    if not entry_type:
        fail(f"Entry type is required (one of: {', '.join(ENTRY_TYPES)})")
    entry_type = clean_choice(entry_type, ENTRY_TYPES, "type", required=True)
    if args.entry_type and "type" in payload and str(payload["type"]).strip().lower() != entry_type:
        fail(f"Conflicting entry type: CLI arg {entry_type!r} vs JSON {payload['type']!r}")

    allowed = COMMON_ADD_KEYS | TYPE_KEYS[entry_type]
    if payload:
        validate_json_keys(payload, allowed, f"add {entry_type}")

    flag_map = {
        "when": args.when,
        "notes": args.notes,
        "slot": args.slot,
        "description": args.description,
        "kcal": args.kcal,
        "protein_g": args.protein,
        "tags": args.tags,
        "weight_kg": args.weight_kg,
        "waist_in": args.waist_in,
        "context": args.context,
        "hours": args.hours,
        "ahi": args.ahi,
        "mask_offs": args.mask_offs,
        "leak_lpm": args.leak_lpm,
        "refreshed": args.refreshed,
        "name": args.name,
        "dose": args.dose,
        "status": args.status,
        "timing": args.timing,
        "kind": args.kind,
        "duration_min": args.duration_min,
        "exercises": args.exercises,
        "what": args.what,
        "trigger": args.trigger,
        "kcal_est": args.kcal_est,
        "protein_g_est": args.protein_est,
    }
    if args.fasted is not None:
        flag_map["fasted"] = args.fasted
    if args.staple:
        parsed_items = []
        for spec in args.staple:
            slug_part, sep, qty_part = spec.partition(":")
            qty = float(qty_part) if sep and qty_part.strip() else 1.0
            parsed_items.append({"staple": slug_part.strip(), "qty": qty})
        flag_map["items"] = parsed_items

    merged = dict(payload)
    for k, v in flag_map.items():
        if v is not None:
            if k not in allowed:
                fail(f"Flag for {k!r} is not valid for entry type {entry_type!r}")
            merged[k] = v

    when_dt = parse_timestamp(merged.get("when"), default_now=True)
    notes = clean_text(merged.get("notes"), "notes")
    staples_map = load_staples(root).get("staples", {})
    typed_fields = validate_entry_fields(entry_type, merged, staples_map)

    ym = when_dt.strftime("%Y-%m")
    target_path = logs_dir(root) / f"{ym}.jsonl"

    with write_lock(health_dir(root)):
        all_records = load_entries_for_write(root, include_archived=True)
        existing_ids = {r["entry"]["id"] for r in all_records}
        entry_id = allocate_id(when_dt, existing_ids)
        ts = now_local().isoformat()
        entry: dict[str, Any] = {
            "id": entry_id,
            "type": entry_type,
            "when": when_dt.isoformat(),
            "date": when_dt.date().isoformat(),
            **typed_fields,
            "created": ts,
            "revision": 1,
        }
        if notes:
            entry["notes"] = notes

        month_entries = [r["entry"] for r in all_records if not r["archived"] and r["path"] == target_path]
        month_entries.append(entry)
        write_jsonl_file(target_path, month_entries)

        day_totals = None
        if entry_type == "meal":
            day_meals = [e for e in month_entries if e["type"] == "meal" and e["date"] == entry["date"]]
            day_totals = {
                "date": entry["date"],
                "meals": len(day_meals),
                "kcal": round1(sum(float(m["kcal"]) for m in day_meals)),
                "protein_g": round1(sum(float(m["protein_g"]) for m in day_meals)),
                "estimated": any(m.get("estimated", True) for m in day_meals),
            }

        workout_counts = None
        if entry_type == "workout":
            live_entries = [r["entry"] for r in all_records if not r["archived"]] + [entry]
            workout_counts = compute_workout_counts(live_entries, kind=entry["kind"])

    tab_name, row_vals = entry_to_sheet_row(entry)
    out: dict[str, Any] = {
        "ok": True,
        "action": "added",
        "entry": entry,
        "path": rel(root, target_path),
        "sheet_row": {"tab": tab_name, "headers": SHEET_HEADERS[tab_name], "row": row_vals},
    }
    if day_totals is not None:
        out["day_totals"] = day_totals
    if workout_counts is not None:
        out["workout_counts"] = workout_counts
    print(json.dumps(out, ensure_ascii=False))


def cmd_read(args: argparse.Namespace, root: Path) -> None:
    records, warnings = load_entries(root, include_archived=True)
    for r in records:
        if r["entry"]["id"] == args.id:
            out: dict[str, Any] = {
                "ok": True,
                "entry": r["entry"],
                "path": rel(root, r["path"]),
            }
            if r["archived"]:
                out["archived"] = True
            if warnings:
                out["warnings"] = warnings
            print(json.dumps(out, ensure_ascii=False, indent=2))
            return
    fail(f"Health entry not found: {args.id}")


def cmd_list(args: argparse.Namespace, root: Path) -> None:
    if args.date:
        d = parse_date_only(args.date, "--date")
        since_dt, until_dt = parse_range_bounds(d.isoformat(), d.isoformat())
    else:
        since_dt, until_dt = parse_range_bounds(args.since, args.until)

    since_ym = since_dt.strftime("%Y-%m") if since_dt else None
    until_ym = until_dt.strftime("%Y-%m") if until_dt else None
    req_types = set(args.type or [])

    records, warnings = load_entries(
        root,
        include_archived=args.archived,
        since_ym=since_ym,
        until_ym=until_ym,
    )
    items: list[dict[str, Any]] = []
    for r in records:
        e = r["entry"]
        if req_types and e["type"] not in req_types:
            continue
        dt = parse_timestamp(e["when"], default_now=False)
        if since_dt is not None and dt < since_dt:
            continue
        if until_dt is not None and dt > until_dt:
            continue
        row = dict(e)
        row["path"] = rel(root, r["path"])
        if r["archived"]:
            row["archived"] = True
        items.append(row)

    items.sort(key=lambda r: (r["when"], r["id"]), reverse=args.newest_first)
    page, page_meta = paginate(items, limit=args.limit, offset=args.offset)
    out: dict[str, Any] = {"ok": True, **page_meta, "entries": page}
    if warnings:
        out["warnings"] = warnings
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_fix(args: argparse.Namespace, root: Path) -> None:
    payload: dict[str, Any] = {}
    if args.json:
        raw_text = sys.stdin.read()
        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError as e:
            fail(f"Invalid JSON on stdin: {e}")
        if not isinstance(parsed, dict):
            fail("fix --json expects a JSON object")
        payload = parsed

    with write_lock(health_dir(root)):
        all_records = load_entries_for_write(root, include_archived=True)
        match = next((r for r in all_records if r["entry"]["id"] == args.id), None)
        if match is None:
            fail(f"Health entry not found: {args.id}")
        if match["archived"]:
            fail(f"Health entry {args.id} is archived; restore it before fixing")

        old = dict(match["entry"])
        entry_type = old["type"]
        allowed = COMMON_FIX_KEYS | TYPE_KEYS[entry_type]
        if payload:
            validate_json_keys(payload, allowed, f"fix {entry_type}")

        flag_map = {
            "when": args.when,
            "notes": args.notes,
            "expected_revision": args.expected_revision,
            "slot": args.slot,
            "description": args.description,
            "kcal": args.kcal,
            "protein_g": args.protein,
            "tags": args.tags,
            "weight_kg": args.weight_kg,
            "waist_in": args.waist_in,
            "context": args.context,
            "hours": args.hours,
            "ahi": args.ahi,
            "mask_offs": args.mask_offs,
            "leak_lpm": args.leak_lpm,
            "refreshed": args.refreshed,
            "name": args.name,
            "dose": args.dose,
            "status": args.status,
            "timing": args.timing,
            "kind": args.kind,
            "duration_min": args.duration_min,
            "exercises": args.exercises,
            "what": args.what,
            "trigger": args.trigger,
            "kcal_est": args.kcal_est,
            "protein_g_est": args.protein_est,
        }
        if args.fasted is not None:
            flag_map["fasted"] = args.fasted
        if args.staple:
            parsed_items = []
            for spec in args.staple:
                slug_part, sep, qty_part = spec.partition(":")
                qty = float(qty_part) if sep and qty_part.strip() else 1.0
                parsed_items.append({"staple": slug_part.strip(), "qty": qty})
            flag_map["items"] = parsed_items

        updates = dict(payload)
        for k, v in flag_map.items():
            if v is not None:
                if k not in allowed:
                    fail(f"Flag for {k!r} is not valid for entry type {entry_type!r}")
                updates[k] = v

        if not (set(updates) - {"expected_revision"}):
            fail("Nothing to fix; provide at least one field to update")

        expected_rev = updates.pop("expected_revision", None)
        if expected_rev is not None:
            if isinstance(expected_rev, bool) or not isinstance(expected_rev, int):
                fail(f"expected_revision must be an integer, got {expected_rev!r}")
            if expected_rev != old.get("revision", 1):
                fail(f"Conflict: expected revision {expected_rev}, found {old.get('revision', 1)}")

        when_dt = parse_timestamp(updates.pop("when", old["when"]), default_now=False)
        notes = clean_text(updates.pop("notes", old.get("notes", "")), "notes")

        # Merge remaining typed fields with old typed fields
        merged_typed: dict[str, Any] = {k: v for k, v in old.items() if k in TYPE_KEYS[entry_type]}
        if entry_type == "meal" and "items" in updates:
            # Re-derive kcal/protein/description from updated items unless also explicitly supplied
            if "kcal" not in updates:
                merged_typed.pop("kcal", None)
            if "protein_g" not in updates:
                merged_typed.pop("protein_g", None)
            if "description" not in updates:
                merged_typed.pop("description", None)
        for k, v in updates.items():
            if v is None or v == "":
                merged_typed.pop(k, None)
            else:
                merged_typed[k] = v

        staples_map = load_staples(root).get("staples", {})
        typed_fields = validate_entry_fields(entry_type, merged_typed, staples_map)

        new_entry: dict[str, Any] = {
            "id": old["id"],
            "type": entry_type,
            "when": when_dt.isoformat(),
            "date": when_dt.date().isoformat(),
            **typed_fields,
            "created": old.get("created", old["when"]),
            "revision": old.get("revision", 1),
        }
        if notes:
            new_entry["notes"] = notes

        old_cmp = {k: v for k, v in old.items() if k not in ("updated", "revision")}
        new_cmp = {k: v for k, v in new_entry.items() if k not in ("updated", "revision")}
        if old_cmp == new_cmp:
            print(json.dumps({
                "ok": True,
                "action": "unchanged",
                "entry": old,
                "path": rel(root, match["path"]),
            }, ensure_ascii=False))
            return

        new_entry["revision"] = old.get("revision", 1) + 1
        new_entry["updated"] = now_local().isoformat()

        old_path: Path = match["path"]
        new_path = logs_dir(root) / f"{when_dt.strftime('%Y-%m')}.jsonl"

        if old_path == new_path:
            month_entries = [
                new_entry if r["entry"]["id"] == old["id"] else r["entry"]
                for r in all_records
                if not r["archived"] and r["path"] == old_path
            ]
            write_jsonl_file(old_path, month_entries)
        else:
            old_month = [
                r["entry"]
                for r in all_records
                if not r["archived"] and r["path"] == old_path and r["entry"]["id"] != old["id"]
            ]
            new_month = [r["entry"] for r in all_records if not r["archived"] and r["path"] == new_path]
            new_month.append(new_entry)
            write_jsonl_file(new_path, new_month)
            write_jsonl_file(old_path, old_month)

    tab_name, row_vals = entry_to_sheet_row(new_entry)
    print(json.dumps({
        "ok": True,
        "action": "fixed",
        "entry": new_entry,
        "path": rel(root, new_path),
        "sheet_row": {"tab": tab_name, "headers": SHEET_HEADERS[tab_name], "row": row_vals},
    }, ensure_ascii=False))


def cmd_delete(args: argparse.Namespace, root: Path) -> None:
    with write_lock(health_dir(root)):
        all_records = load_entries_for_write(root, include_archived=True)
        match = next((r for r in all_records if not r["archived"] and r["entry"]["id"] == args.id), None)
        if match is None:
            fail(f"Health entry not found: {args.id}")

        src_path: Path = match["path"]
        remaining = [
            r["entry"]
            for r in all_records
            if not r["archived"] and r["path"] == src_path and r["entry"]["id"] != args.id
        ]

        if args.hard:
            write_jsonl_file(src_path, remaining)
            print(json.dumps({"ok": True, "id": args.id, "action": "hard_deleted"}, ensure_ascii=False))
            return

        entry = dict(match["entry"])
        entry["revision"] = entry.get("revision", 1) + 1
        entry["updated"] = now_local().isoformat()
        arch_path = archive_dir(root) / src_path.name
        arch_entries = [r["entry"] for r in all_records if r["archived"] and r["path"] == arch_path]
        arch_entries.append(entry)
        write_jsonl_file(arch_path, arch_entries)
        write_jsonl_file(src_path, remaining)

    print(json.dumps({
        "ok": True,
        "id": args.id,
        "action": "archived",
        "path": rel(root, arch_path),
    }, ensure_ascii=False))


def cmd_restore(args: argparse.Namespace, root: Path) -> None:
    with write_lock(health_dir(root)):
        all_records = load_entries_for_write(root, include_archived=True)
        match = next((r for r in all_records if r["archived"] and r["entry"]["id"] == args.id), None)
        if match is None:
            fail(f"Archived health entry not found: {args.id}")

        entry = dict(match["entry"])
        entry["revision"] = entry.get("revision", 1) + 1
        entry["updated"] = now_local().isoformat()
        arch_path: Path = match["path"]
        ym = str(entry["date"])[:7]
        dest_path = logs_dir(root) / f"{ym}.jsonl"

        dest_entries = [r["entry"] for r in all_records if not r["archived"] and r["path"] == dest_path]
        dest_entries.append(entry)
        arch_remaining = [
            r["entry"]
            for r in all_records
            if r["archived"] and r["path"] == arch_path and r["entry"]["id"] != args.id
        ]
        write_jsonl_file(dest_path, dest_entries)
        write_jsonl_file(arch_path, arch_remaining)

    print(json.dumps({
        "ok": True,
        "id": args.id,
        "action": "restored",
        "path": rel(root, dest_path),
    }, ensure_ascii=False))


# ---------------------------------------------------------------- summary & report

def resolve_window_dates(since: str | None, until: str | None, days: int) -> tuple[date, date]:
    if days < 1 or days > 90:
        fail("--days must be between 1 and 90")
    today = now_local().date()
    until_d = parse_date_only(until, "--until") if until else today
    since_d = parse_date_only(since, "--since") if since else (until_d - timedelta(days=days - 1))
    if since_d > until_d:
        fail(f"--since ({since_d.isoformat()}) must be on or before --until ({until_d.isoformat()})")
    return since_d, until_d


def cmd_workouts(args: argparse.Namespace, root: Path) -> None:
    since_dt, until_dt = parse_range_bounds(args.since, args.until)
    since_ym = since_dt.strftime("%Y-%m") if since_dt else None
    until_ym = until_dt.strftime("%Y-%m") if until_dt else None
    records, warnings = load_entries(root, include_archived=False, since_ym=since_ym, until_ym=until_ym)
    filtered: list[dict[str, Any]] = []
    for r in records:
        e = r["entry"]
        if e["type"] != "workout":
            continue
        dt = parse_timestamp(e["when"], default_now=False)
        if since_dt is not None and dt < since_dt:
            continue
        if until_dt is not None and dt > until_dt:
            continue
        filtered.append(e)
    counts = compute_workout_counts(filtered, kind=args.kind)
    out: dict[str, Any] = {"ok": True, **counts}
    if warnings:
        out["warnings"] = warnings
    print(json.dumps(out, ensure_ascii=False, indent=2))


def build_local_sheets_rows(
    root: Path,
    *,
    since_dt: datetime | None = None,
    until_dt: datetime | None = None,
) -> tuple[dict[str, list[list[Any]]], list[str]]:
    since_ym = since_dt.strftime("%Y-%m") if since_dt else None
    until_ym = until_dt.strftime("%Y-%m") if until_dt else None
    records, warnings = load_entries(root, include_archived=False, since_ym=since_ym, until_ym=until_ym)
    rows_by_tab: dict[str, list[list[Any]]] = {tab: [] for tab in SHEET_HEADERS}

    live = [r["entry"] for r in records]
    live.sort(key=lambda e: (e["when"], e["id"]))
    for e in live:
        dt = parse_timestamp(e["when"], default_now=False)
        if since_dt is not None and dt < since_dt:
            continue
        if until_dt is not None and dt > until_dt:
            continue
        tab_name, row_vals = entry_to_sheet_row(e)
        rows_by_tab[tab_name].append(row_vals)

    staples_data = load_staples(root).get("staples", {})
    for slug in sorted(staples_data):
        info = staples_data[slug]
        rows_by_tab["Staples"].append([
            slug,
            info.get("name", ""),
            info.get("unit", ""),
            info.get("kcal", ""),
            info.get("protein_g", ""),
            ", ".join(info.get("aliases", [])),
            info.get("notes", ""),
        ])
    return rows_by_tab, warnings


def cmd_export_sheets(args: argparse.Namespace, root: Path) -> None:
    since_dt, until_dt = parse_range_bounds(args.since, args.until)
    rows_by_tab, warnings = build_local_sheets_rows(root, since_dt=since_dt, until_dt=until_dt)
    cfg = load_config(root)
    tabs = {
        tab: {"headers": SHEET_HEADERS[tab], "rows": rows_by_tab[tab]}
        for tab in SHEET_HEADERS
    }
    out: dict[str, Any] = {
        "ok": True,
        "sheets": cfg.get("sheets") or {},
        "tabs": tabs,
    }
    if warnings:
        out["warnings"] = warnings
    print(json.dumps(out, ensure_ascii=False, indent=2))


def read_remote_tabs_stdin(cmd: str) -> dict[str, Any]:
    raw_text = sys.stdin.read()
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as e:
        fail(f"Invalid JSON on stdin for {cmd}: {e}")
    if not isinstance(parsed, dict):
        fail(f"{cmd} --json expects a JSON object")
    if "tabs" in parsed:
        tabs = parsed["tabs"]
        if not isinstance(tabs, dict):
            fail(f"{cmd}: 'tabs' must be a JSON object")
        return tabs
    return parsed


def cmd_sync_plan(args: argparse.Namespace, root: Path) -> None:
    raw_remote = read_remote_tabs_stdin("sync-plan")
    remote_tabs = extract_remote_rows(raw_remote, SHEET_HEADERS)
    local_tabs, warnings = build_local_sheets_rows(root)
    all_records, arch_warnings = load_entries(root, include_archived=True)
    archived_ids = {r["entry"]["id"] for r in all_records if r["archived"]}
    base_state = load_sync_state(root)
    plan = build_sync_plan(
        local_tabs=local_tabs,
        archived_ids=archived_ids,
        remote_tabs=remote_tabs,
        base_tabs=base_state.get("tabs") or {},
        headers_map=SHEET_HEADERS,
        prefer=args.prefer,
    )
    out: dict[str, Any] = {
        "ok": True,
        "last_synced_at": base_state.get("synced_at"),
        **plan,
    }
    all_warn = sorted(set(warnings + arch_warnings))
    if all_warn:
        out["warnings"] = all_warn
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_sync_apply(args: argparse.Namespace, root: Path) -> None:
    raw_remote = read_remote_tabs_stdin("sync-apply")
    remote_tabs = extract_remote_rows(raw_remote, SHEET_HEADERS)
    with write_lock(health_dir(root)):
        all_records = load_entries_for_write(root, include_archived=True)
        local_tabs, _ = build_local_sheets_rows(root)
        archived_ids = {r["entry"]["id"] for r in all_records if r["archived"]}
        base_state = load_sync_state(root)
        plan = build_sync_plan(
            local_tabs=local_tabs,
            archived_ids=archived_ids,
            remote_tabs=remote_tabs,
            base_tabs=base_state.get("tabs") or {},
            headers_map=SHEET_HEADERS,
            prefer=args.prefer,
        )
        if plan["conflicts"]:
            fail(
                f"Sync has {len(plan['conflicts'])} conflict(s); resolve with --prefer local|remote "
                "or fix one side before running sync-apply"
            )

        staples_doc = load_staples(root)
        staples_map = staples_doc["staples"]
        staples_dirty = False
        existing_ids = {r["entry"]["id"] for r in all_records}
        live_by_id: dict[str, dict[str, Any]] = {
            r["entry"]["id"]: dict(r["entry"]) for r in all_records if not r["archived"]
        }
        arch_by_id: dict[str, dict[str, Any]] = {
            r["entry"]["id"]: dict(r["entry"]) for r in all_records if r["archived"]
        }
        dirty_months: set[str] = set()
        dirty_arch_months: set[str] = set()

        applied: dict[str, list[dict[str, Any]]] = {
            "pulled_added": [],
            "pulled_updated": [],
            "deleted_local": [],
        }
        id_writebacks: list[dict[str, Any]] = []
        ts = now_local().isoformat()

        # 1. pull_add (manual or remote-only rows -> local JSONL or staples.json)
        for item in plan["pull_add"]:
            tab = item["tab"]
            row = item["row"]
            if tab == "Staples":
                slug_res = row_to_staple_payload(row)
                if slug_res[0] is None:
                    continue
                slug, payload = slug_res
                slug = clean_slug(slug)
                staples_map[slug] = payload
                staples_dirty = True
                applied["pulled_added"].append({"tab": tab, "id": slug})
                continue

            etype_res = row_to_entry_payload(tab, row)
            if etype_res[0] is None:
                continue
            etype, payload = etype_res
            when_dt = parse_timestamp(payload.pop("when", None), default_now=False)
            notes = clean_text(payload.pop("notes", ""), "notes")
            typed_fields = validate_entry_fields(etype, payload, staples_map)
            cand_id = str(item.get("id") or "").strip()
            if cand_id and ID_RE.match(cand_id) and cand_id not in live_by_id:
                entry_id = cand_id
                if entry_id in arch_by_id:
                    old_arch = arch_by_id.pop(entry_id)
                    dirty_arch_months.add(str(old_arch["date"])[:7])
            else:
                entry_id = allocate_id(when_dt, existing_ids)
                existing_ids.add(entry_id)

            entry: dict[str, Any] = {
                "id": entry_id,
                "type": etype,
                "when": when_dt.isoformat(),
                "date": when_dt.date().isoformat(),
                **typed_fields,
                "created": ts,
                "revision": 1,
            }
            if notes:
                entry["notes"] = notes
            live_by_id[entry_id] = entry
            dirty_months.add(when_dt.strftime("%Y-%m"))
            applied["pulled_added"].append({"tab": tab, "id": entry_id})
            if not item.get("has_id") or entry_id != cand_id:
                _, canonical_row = entry_to_sheet_row(entry)
                id_writebacks.append({
                    "tab": tab,
                    "id": entry_id,
                    "remote_row_index": item["remote_row_index"],
                    "row": canonical_row,
                })

        # 2. pull_update (remote-edited rows -> update local entry or staple)
        for item in plan["pull_update"]:
            tab = item["tab"]
            row = item["row"]
            key = item["id"]
            if tab == "Staples":
                slug_res = row_to_staple_payload(row)
                if slug_res[0] is None:
                    continue
                _, payload = slug_res
                staples_map[key] = payload
                staples_dirty = True
                applied["pulled_updated"].append({"tab": tab, "id": key})
                continue

            old = live_by_id.get(key)
            if old is None:
                continue
            etype_res = row_to_entry_payload(tab, row)
            if etype_res[0] is None:
                continue
            etype, payload = etype_res
            when_dt = parse_timestamp(payload.pop("when", old["when"]), default_now=False)
            notes = clean_text(payload.pop("notes", ""), "notes")
            typed_fields = validate_entry_fields(etype, payload, staples_map)
            old_ym = str(old["date"])[:7]
            new_ym = when_dt.strftime("%Y-%m")
            new_entry: dict[str, Any] = {
                "id": old["id"],
                "type": etype,
                "when": when_dt.isoformat(),
                "date": when_dt.date().isoformat(),
                **typed_fields,
                "created": old.get("created", old["when"]),
                "updated": ts,
                "revision": old.get("revision", 1) + 1,
            }
            if notes:
                new_entry["notes"] = notes
            live_by_id[key] = new_entry
            dirty_months.add(old_ym)
            dirty_months.add(new_ym)
            applied["pulled_updated"].append({"tab": tab, "id": key})

        # 3. delete_local (rows deleted in Sheet -> soft-archive locally or delete staple)
        for item in plan["delete_local"]:
            tab = item["tab"]
            key = item["id"]
            if tab == "Staples":
                if key in staples_map:
                    del staples_map[key]
                    staples_dirty = True
                    applied["deleted_local"].append({"tab": tab, "id": key})
                continue
            old = live_by_id.pop(key, None)
            if old is None:
                continue
            ym = str(old["date"])[:7]
            old["revision"] = old.get("revision", 1) + 1
            old["updated"] = ts
            arch_by_id[key] = old
            dirty_months.add(ym)
            dirty_arch_months.add(ym)
            applied["deleted_local"].append({"tab": tab, "id": key})

        # Flush modified files atomically
        for ym in sorted(dirty_months):
            ents = [e for e in live_by_id.values() if str(e["date"])[:7] == ym]
            write_jsonl_file(logs_dir(root) / f"{ym}.jsonl", ents)
        for ym in sorted(dirty_arch_months):
            ents = [e for e in arch_by_id.values() if str(e["date"])[:7] == ym]
            write_jsonl_file(archive_dir(root) / f"{ym}.jsonl", ents)
        if staples_dirty:
            save_staples(root, staples_doc)

    print(json.dumps({
        "ok": True,
        "applied": applied,
        "sheet_actions": {
            "push_append": plan["push_append"],
            "push_update": plan["push_update"] + id_writebacks,
            "remote_delete": plan["remote_delete"],
        },
        "invalid_remote_rows": plan["invalid_remote_rows"],
    }, ensure_ascii=False, indent=2))


def cmd_sync_mark(args: argparse.Namespace, root: Path) -> None:
    with write_lock(health_dir(root)):
        load_entries_for_write(root, include_archived=True)
        local_tabs, _ = build_local_sheets_rows(root)
        snapshot: dict[str, dict[str, list[Any]]] = {}
        for tab, headers in SHEET_HEADERS.items():
            width = len(headers)
            tab_map: dict[str, list[Any]] = {}
            for row in local_tabs.get(tab, []):
                nr = normalize_row(tab, row, width)
                k = row_key(tab, nr)
                if k:
                    tab_map[k] = nr
            snapshot[tab] = tab_map
        ts = now_local().isoformat()
        state = {"version": 1, "synced_at": ts, "tabs": snapshot}
        save_sync_state(root, state)
    print(json.dumps({
        "ok": True,
        "synced_at": ts,
        "counts": {tab: len(rows) for tab, rows in snapshot.items()},
        "path": rel(root, sync_state_path(root)),
    }, ensure_ascii=False))


def cmd_summary(args: argparse.Namespace, root: Path) -> None:
    since_d, until_d = resolve_window_dates(args.since, args.until, args.days)
    summary = build_summary(root, since_d, until_d)
    print(json.dumps({"ok": True, **summary}, ensure_ascii=False, indent=2))


def cmd_report(args: argparse.Namespace, root: Path) -> None:
    since_d, until_d = resolve_window_dates(args.since, args.until, args.days)
    summary = build_summary(root, since_d, until_d)
    html_text = render_weekly_html(summary, title=args.title)
    if args.out:
        out_path = Path(args.out).expanduser()
        if not out_path.is_absolute():
            out_path = (root / out_path).resolve()
        atomic_write(out_path, html_text)
        try:
            display_path = out_path.relative_to(root).as_posix()
        except ValueError:
            display_path = str(out_path)
        print(json.dumps({
            "ok": True,
            "path": display_path,
            "abs_path": str(out_path),
            "since": summary["since"],
            "until": summary["until"],
            "entry_count": summary["entry_count"],
        }, ensure_ascii=False))
    else:
        sys.stdout.write(html_text)


# ---------------------------------------------------------------- staples commands

def cmd_staples(args: argparse.Namespace, root: Path) -> None:
    action = args.staples_cmd
    if action == "list":
        data = load_staples(root)
        items = []
        q = (args.search or "").strip().lower()
        for slug in sorted(data["staples"]):
            info = data["staples"][slug]
            if q:
                hay = " ".join([slug, info.get("name", ""), " ".join(info.get("aliases", [])), info.get("notes", "")]).lower()
                if q not in hay:
                    continue
            items.append({"slug": slug, **info})
        print(json.dumps({"ok": True, "count": len(items), "note": data.get("note", ""), "staples": items}, ensure_ascii=False, indent=2))
        return

    if action == "add":
        payload = read_json_stdin(STAPLE_ADD_KEYS, "staples add") if args.json else {}
        slug = clean_slug(args.slug or payload.get("slug"))
        name = clean_text(args.name if args.name is not None else payload.get("name"), "name", required=True, single_line=True)
        unit = clean_text(args.unit if args.unit is not None else payload.get("unit") or "serving", "unit", required=True, single_line=True)
        kcal = num_or_none(args.kcal if args.kcal is not None else payload.get("kcal"), "kcal", min_val=0)
        protein_g = num_or_none(args.protein if args.protein is not None else payload.get("protein_g"), "protein_g", min_val=0)
        if kcal is None or protein_g is None:
            fail("staples add requires numeric kcal and protein_g")
        aliases_raw = args.alias if args.alias is not None else payload.get("aliases", [])
        aliases = [clean_text(a, "aliases", single_line=True).lower() for a in normalize_list(aliases_raw) if str(a).strip()]
        notes = clean_text(args.notes if args.notes is not None else payload.get("notes"), "notes")
        est = True if "estimated" not in payload else bool(bool_or_none(payload["estimated"], "estimated"))

        with write_lock(health_dir(root)):
            data = load_staples(root)
            if slug in data["staples"]:
                fail(f"Staple {slug!r} already exists; use `staples fix {slug}` to update it")
            rec: dict[str, Any] = {
                "name": name,
                "unit": unit,
                "kcal": round1(kcal),
                "protein_g": round1(protein_g),
                "estimated": est,
            }
            if aliases:
                rec["aliases"] = sorted(set(aliases))
            if notes:
                rec["notes"] = notes
            data["staples"][slug] = rec
            save_staples(root, data)
        print(json.dumps({"ok": True, "action": "added", "slug": slug, "staple": rec, "path": rel(root, staples_path(root))}, ensure_ascii=False))
        return

    if action == "fix":
        payload = read_json_stdin(STAPLE_FIX_KEYS, "staples fix") if args.json else {}
        slug = clean_slug(args.slug)
        with write_lock(health_dir(root)):
            data = load_staples(root)
            if slug not in data["staples"]:
                fail(f"Staple not found: {slug}")
            rec = dict(data["staples"][slug])
            updates = dict(payload)
            for k, v in (
                ("name", args.name),
                ("unit", args.unit),
                ("kcal", args.kcal),
                ("protein_g", args.protein),
                ("aliases", args.alias),
                ("notes", args.notes),
            ):
                if v is not None:
                    updates[k] = v
            if not updates:
                fail("Nothing to update on staple")
            if "name" in updates:
                rec["name"] = clean_text(updates["name"], "name", required=True, single_line=True)
            if "unit" in updates:
                rec["unit"] = clean_text(updates["unit"], "unit", required=True, single_line=True)
            if "kcal" in updates:
                val = num_or_none(updates["kcal"], "kcal", min_val=0)
                if val is None:
                    fail("kcal must be a number")
                rec["kcal"] = round1(val)
            if "protein_g" in updates:
                val = num_or_none(updates["protein_g"], "protein_g", min_val=0)
                if val is None:
                    fail("protein_g must be a number")
                rec["protein_g"] = round1(val)
            if "estimated" in updates:
                rec["estimated"] = bool(bool_or_none(updates["estimated"], "estimated"))
            if "aliases" in updates:
                als = sorted({clean_text(a, "aliases", single_line=True).lower() for a in normalize_list(updates["aliases"]) if str(a).strip()})
                if als:
                    rec["aliases"] = als
                else:
                    rec.pop("aliases", None)
            if "notes" in updates:
                n = clean_text(updates["notes"], "notes")
                if n:
                    rec["notes"] = n
                else:
                    rec.pop("notes", None)
            data["staples"][slug] = rec
            save_staples(root, data)
        print(json.dumps({"ok": True, "action": "fixed", "slug": slug, "staple": rec, "path": rel(root, staples_path(root))}, ensure_ascii=False))
        return

    if action == "delete":
        slug = clean_slug(args.slug)
        with write_lock(health_dir(root)):
            data = load_staples(root)
            if slug not in data["staples"]:
                fail(f"Staple not found: {slug}")
            del data["staples"][slug]
            save_staples(root, data)
        print(json.dumps({"ok": True, "action": "deleted", "slug": slug, "path": rel(root, staples_path(root))}, ensure_ascii=False))


# ---------------------------------------------------------------- config commands

def cmd_config(args: argparse.Namespace, root: Path) -> None:
    if args.config_cmd == "show":
        cfg = load_config(root)
        print(json.dumps({"ok": True, "config": cfg, "path": rel(root, config_path(root))}, ensure_ascii=False, indent=2))
        return

    payload = read_json_stdin(CONFIG_KEYS, "config set")
    with write_lock(health_dir(root)):
        cfg = load_config(root)
        baseline = dict(cfg.get("baseline") or {})
        targets = dict(cfg.get("targets") or {})
        sheets = dict(cfg.get("sheets") or {})

        if "baseline" in payload:
            b = payload["baseline"]
            if not isinstance(b, dict):
                fail("config baseline must be a JSON object")
            validate_json_keys(b, BASELINE_KEYS, "config.baseline")
            for k, lo, hi in (("weight_kg", 20, 400), ("waist_in", 15, 100)):
                if k in b:
                    val = num_or_none(b[k], f"baseline.{k}", min_val=lo, max_val=hi)
                    set_or_pop(baseline, k, None if val is None else round1(val))
            if "date" in b:
                set_or_pop(baseline, "date",
                           parse_date_only(str(b["date"]), "baseline.date").isoformat() if b["date"] else None)

        if "targets" in payload:
            t = payload["targets"]
            if not isinstance(t, dict):
                fail("config targets must be a JSON object")
            validate_json_keys(t, TARGET_KEYS, "config.targets")
            for k, lo, hi in (
                ("protein_g_min", 1, 500),
                ("kcal_max", 500, 10000),
                ("cpap_hours_min", 0.5, 16),
                ("cpap_ahi_max", 0.1, 100),
            ):
                if k in t:
                    val = num_or_none(t[k], f"targets.{k}", min_val=lo, max_val=hi)
                    set_or_pop(targets, k, None if val is None else round1(val))
            if "meds" in t:
                if not isinstance(t["meds"], list):
                    fail("targets.meds must be a JSON list")
                meds_clean = []
                for idx, m in enumerate(t["meds"]):
                    if not isinstance(m, dict):
                        fail(f"targets.meds[{idx}] must be a JSON object")
                    validate_json_keys(m, MED_TARGET_KEYS, f"targets.meds[{idx}]")
                    nm = clean_text(m.get("name"), f"targets.meds[{idx}].name", required=True, single_line=True).lower()
                    dose = clean_text(m.get("dose"), f"targets.meds[{idx}].dose", single_line=True)
                    epd = int_or_none(m.get("expected_per_day", 1), f"targets.meds[{idx}].expected_per_day", min_val=1)
                    rec: dict[str, Any] = {"name": nm, "expected_per_day": epd}
                    if dose:
                        rec["dose"] = dose
                    meds_clean.append(rec)
                targets["meds"] = meds_clean

        if "sheets" in payload:
            sh = payload["sheets"]
            if not isinstance(sh, dict):
                fail("config sheets must be a JSON object")
            validate_json_keys(sh, SHEETS_KEYS, "config.sheets")
            for k in ("spreadsheet_id", "title", "url", "permission_rule_id"):
                if k in sh:
                    set_or_pop(sheets, k, clean_text(sh[k], f"sheets.{k}", single_line=True))

        cfg = {"version": 1, "baseline": baseline, "targets": targets}
        if sheets:
            cfg["sheets"] = sheets
        save_config(root, cfg)

    print(json.dumps({"ok": True, "action": "updated", "config": cfg, "path": rel(root, config_path(root))}, ensure_ascii=False))


# ---------------------------------------------------------------- parser

def add_entry_flags(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--when", help="Timestamp (YYYY-MM-DD, 'YYYY-MM-DD HH:MM', ISO-8601, or relative like 24h)")
    parser.add_argument("--notes", help="Optional notes")
    # meal
    parser.add_argument("--slot", choices=MEAL_SLOTS)
    parser.add_argument("--description", help="Short meal description")
    parser.add_argument("--kcal", type=float)
    parser.add_argument("--protein", type=float, help="Protein in grams")
    parser.add_argument("--tags", help="Comma-separated lowercase tags")
    # weight
    parser.add_argument("--weight-kg", type=float)
    parser.add_argument("--waist-in", type=float)
    parser.add_argument("--context", help="Measurement context (e.g. morning-fasted)")
    # cpap
    parser.add_argument("--hours", type=float)
    parser.add_argument("--ahi", type=float)
    parser.add_argument("--mask-offs", type=int)
    parser.add_argument("--leak-lpm", type=float)
    parser.add_argument("--refreshed", choices=CPAP_REFRESHED)
    # med
    parser.add_argument("--name", help="Medication name")
    parser.add_argument("--dose", help="Medication dose")
    parser.add_argument("--status", help="Status (med: taken/missed/partial/skipped; workout: attended/missed/missed_and_paid)")
    parser.add_argument("--timing", help="Medication timing (e.g. after-dinner)")
    # workout
    parser.add_argument("--kind", choices=WORKOUT_KINDS)
    parser.add_argument("--duration-min", type=float)
    parser.add_argument("--exercises", type=int)
    parser.add_argument("--fasted", action=argparse.BooleanOptionalAction, default=None)
    # slip
    parser.add_argument("--what", help="What the diet slip was")
    parser.add_argument("--trigger", help="Slip trigger (e.g. work-escape, habit, stress, social)")
    parser.add_argument("--kcal-est", type=float)
    parser.add_argument("--protein-est", type=float)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog=PROG, description="Thoth health-tracker CLI")
    p.add_argument("--root", help="Instance root (default: current folder; mainly for tests)")
    p.add_argument("--allow-worktree", action="store_true", help="Allow running inside a linked git worktree")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add", help="Add a typed health log entry (prefer --json <<'EOF')")
    a.add_argument("entry_type", nargs="?", choices=ENTRY_TYPES, help="Entry type (or pass 'type' inside --json)")
    a.add_argument("--staple", action="append", help="Meal staple item as '<slug>[:<qty>]' (repeatable)")
    add_entry_flags(a)
    a.add_argument("--json", action="store_true", help="Read JSON object on stdin (strictly validates keys)")

    r = sub.add_parser("read", help="Read one entry by ID (live or archived)")
    r.add_argument("id")

    ls = sub.add_parser("list", help="List health entries chronologically with optional filters")
    ls.add_argument("--type", action="append", choices=ENTRY_TYPES, help="Entry type filter (repeatable)")
    ls.add_argument("--date", help="Single calendar date YYYY-MM-DD")
    ls.add_argument("--since", help="Inclusive start: YYYY-MM-DD, ISO-8601, or relative (24h, 7d, 2w, 1mo)")
    ls.add_argument("--until", help="Inclusive end: YYYY-MM-DD, ISO-8601, or relative")
    ls.add_argument("--limit", type=int, default=0, help="Max entries to return (0 = all)")
    ls.add_argument("--offset", type=int, default=0, help="Entries to skip")
    ls.add_argument("--newest-first", action="store_true")
    ls.add_argument("--archived", action="store_true")

    fx = sub.add_parser("fix", help="Fix an existing entry by ID (bumps revision, stamps updated)")
    fx.add_argument("id")
    fx.add_argument("--expected-revision", type=int)
    fx.add_argument("--staple", action="append", help="Replace meal staple items as '<slug>[:<qty>]' (repeatable)")
    add_entry_flags(fx)
    fx.add_argument("--json", action="store_true", help="Read JSON object on stdin (strictly validates keys)")

    dl = sub.add_parser("delete", help="Soft-delete (archive) an entry by ID")
    dl.add_argument("id")
    dl.add_argument("--hard", action="store_true", help="Permanently remove instead of archiving")

    rs = sub.add_parser("restore", help="Restore an archived entry by ID")
    rs.add_argument("id")

    wk = sub.add_parser("workouts", help="Count workout sessions (trainer billing or solo) with dates")
    wk.add_argument("--kind", choices=("trainer", "solo", "all"), default="trainer", help="Filter by kind (default: trainer)")
    wk.add_argument("--since", help="Optional inclusive start date/timestamp")
    wk.add_argument("--until", help="Optional inclusive end date/timestamp")

    ex = sub.add_parser("export-sheets", help="Export tabular headers and rows per Google Sheet worksheet tab")
    ex.add_argument("--since", help="Optional inclusive start date/timestamp")
    ex.add_argument("--until", help="Optional inclusive end date/timestamp")

    sp = sub.add_parser("sync-plan", help="3-way diff between live Google Sheet tabs (on stdin) and local health/ logs")
    sp.add_argument("--prefer", choices=("local", "remote"), help="Optional tie-breaker for conflicts")
    sp.add_argument("--json", action="store_true", help="Read remote tabs JSON on stdin")

    sa = sub.add_parser("sync-apply", help="Apply Sheet-originated pulls/deletes locally and output exact Sheet write actions")
    sa.add_argument("--prefer", choices=("local", "remote"), help="Optional tie-breaker for conflicts")
    sa.add_argument("--json", action="store_true", help="Read remote tabs JSON on stdin")

    sub.add_parser("sync-mark", help="Record current local state as last-synced baseline (health/.sync-state.json)")

    sm = sub.add_parser("summary", help="JSON weekly/range summary (missing days are null/unknown, never zero)")
    sm.add_argument("--since", help="Start date YYYY-MM-DD (default: until - (days - 1))")
    sm.add_argument("--until", help="End date YYYY-MM-DD (default: today)")
    sm.add_argument("--days", type=int, default=7, help="Window length when --since is omitted (default: 7)")

    rp = sub.add_parser("report", help="Render self-contained weekly check-in HTML")
    rp.add_argument("--since", help="Start date YYYY-MM-DD")
    rp.add_argument("--until", help="End date YYYY-MM-DD (default: today)")
    rp.add_argument("--days", type=int, default=7, help="Window length when --since is omitted (default: 7)")
    rp.add_argument("--title", default="Weekly Health Check-In")
    rp.add_argument("--out", help="Write HTML to file path and print JSON metadata (omit to write HTML to stdout)")

    st = sub.add_parser("staples", help="Manage the instance staples food catalog (health/staples.json)")
    st_sub = st.add_subparsers(dest="staples_cmd", required=True)
    st_ls = st_sub.add_parser("list", help="List staples")
    st_ls.add_argument("--search", help="Filter by slug, name, alias, or notes")

    st_add = st_sub.add_parser("add", help="Add a staple food (values marked estimated)")
    st_add.add_argument("slug", nargs="?")
    st_add.add_argument("--name")
    st_add.add_argument("--unit")
    st_add.add_argument("--kcal", type=float)
    st_add.add_argument("--protein", type=float)
    st_add.add_argument("--alias", help="Comma-separated aliases")
    st_add.add_argument("--notes")
    st_add.add_argument("--json", action="store_true")

    st_fix = st_sub.add_parser("fix", help="Update a staple food")
    st_fix.add_argument("slug")
    st_fix.add_argument("--name")
    st_fix.add_argument("--unit")
    st_fix.add_argument("--kcal", type=float)
    st_fix.add_argument("--protein", type=float)
    st_fix.add_argument("--alias", help="Replace aliases (comma-separated, '' clears)")
    st_fix.add_argument("--notes")
    st_fix.add_argument("--json", action="store_true")

    st_del = st_sub.add_parser("delete", help="Delete a staple food")
    st_del.add_argument("slug")

    cf = sub.add_parser("config", help="Read or update baseline and targets (health/config.json)")
    cf_sub = cf.add_subparsers(dest="config_cmd", required=True)
    cf_sub.add_parser("show", help="Show current config")
    cf_set = cf_sub.add_parser("set", help="Set baseline, targets, or sheets from JSON on stdin")
    cf_set.add_argument("--json", action="store_true", required=True, help="Read the JSON payload from stdin")
    return p


def main() -> None:
    args = build_parser().parse_args()
    root = resolve_root(args.root, PROG, allow_worktree=args.allow_worktree)
    dispatch = {
        "add": cmd_add,
        "read": cmd_read,
        "list": cmd_list,
        "fix": cmd_fix,
        "delete": cmd_delete,
        "restore": cmd_restore,
        "workouts": cmd_workouts,
        "export-sheets": cmd_export_sheets,
        "sync-plan": cmd_sync_plan,
        "sync-apply": cmd_sync_apply,
        "sync-mark": cmd_sync_mark,
        "summary": cmd_summary,
        "report": cmd_report,
        "staples": cmd_staples,
        "config": cmd_config,
    }
    dispatch[args.cmd](args, root)


if __name__ == "__main__":
    main()
