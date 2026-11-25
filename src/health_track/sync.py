"""Three-way sync engine between local `health/` logs and Google Sheets tabs.

Pure stdlib, zero network calls. The CLI reads live Sheet rows on stdin,
computes a deterministic diff against local state + last-synced snapshot
(`health/.sync-state.json`), optionally applies Sheet-originated pulls to
local JSONL/staples, and outputs exact Sheet actions for the host connector.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from thoth_core import atomic_write, fail

TAB_TO_TYPE: dict[str, str] = {
    "Workouts": "workout",
    "Meals": "meal",
    "Weight": "weight",
    "CPAP": "cpap",
    "Meds": "med",
    "Slips": "slip",
}

NUMERIC_COLS: dict[str, set[int]] = {
    "Workouts": {3, 4},       # Duration (min), Exercises
    "Meals": {4, 5},          # Kcal (est), Protein g (est)
    "Weight": {2, 3},         # Weight (kg), Waist (in)
    "CPAP": {1, 2, 3},        # Hours, AHI, Mask-offs
    "Meds": set(),
    "Slips": {4},             # Kcal (est)
    "Staples": {3, 4},        # Kcal (est), Protein g (est)
}

INT_COLS: dict[str, set[int]] = {
    "Workouts": {4},          # Exercises
    "CPAP": {3},              # Mask-offs
}


def sync_state_path(root: Path) -> Path:
    return root / "health" / ".sync-state.json"


def load_sync_state(root: Path) -> dict[str, Any]:
    path = sync_state_path(root)
    if not path.exists():
        return {"version": 1, "synced_at": None, "tabs": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        fail(f"Unreadable sync state {path.name}: {e}")
    if not isinstance(data, dict):
        fail(f"Expected JSON object in {path.name}")
    return data


def save_sync_state(root: Path, state: dict[str, Any]) -> None:
    atomic_write(sync_state_path(root), json.dumps(state, ensure_ascii=False, indent=2) + "\n")


def normalize_cell(tab: str, col_idx: int, val: Any) -> Any:
    if val is None:
        return ""
    if isinstance(val, bool):
        return "Yes" if val else "No"
    if col_idx in NUMERIC_COLS.get(tab, set()):
        if isinstance(val, (int, float)):
            f = float(val)
        else:
            s = str(val).strip()
            if not s:
                return ""
            try:
                f = float(s)
            except ValueError:
                return s
        if col_idx in INT_COLS.get(tab, set()) and f.is_integer():
            return int(f)
        r = round(f, 1)
        return int(r) if r.is_integer() and tab in ("Workouts", "CPAP") and col_idx in INT_COLS.get(tab, set()) else r
    s = str(val).strip()
    if tab == "Workouts" and col_idx == 5 and s:
        low = s.lower()
        if low in ("yes", "true", "1"):
            return "Yes"
        if low in ("no", "false", "0"):
            return "No"
    return s


def normalize_row(tab: str, row: list[Any], width: int) -> list[Any]:
    padded = list(row[:width]) + [""] * max(0, width - len(row))
    return [normalize_cell(tab, i, padded[i]) for i in range(width)]


def is_blank_row(row: list[Any]) -> bool:
    return all(v == "" or v is None for v in row)


def extract_remote_rows(
    raw_tabs: dict[str, Any],
    headers_map: dict[str, list[str]],
) -> dict[str, list[tuple[int, list[Any]]]]:
    """Return {tab: [(1-based sheet row index, normalized row), ...]} skipping header & blank rows."""
    out: dict[str, list[tuple[int, list[Any]]]] = {}
    for tab, headers in headers_map.items():
        if tab not in raw_tabs:
            continue
        spec = raw_tabs[tab]
        if isinstance(spec, dict):
            rows_in = spec.get("rows", [])
        elif isinstance(spec, list):
            rows_in = spec
        else:
            fail(f"Remote tab {tab!r} must be a list of rows or an object with 'rows'")
        if not isinstance(rows_in, list):
            fail(f"Remote tab {tab!r} rows must be a list")

        width = len(headers)
        norm_headers = [h.strip().lower() for h in headers]
        parsed: list[tuple[int, list[Any]]] = []
        offset = 0
        for idx, raw_row in enumerate(rows_in):
            if not isinstance(raw_row, list):
                fail(f"Remote tab {tab!r} row {idx + 1} must be a JSON list")
            norm = normalize_row(tab, raw_row, width)
            if idx == 0 and [str(c).strip().lower() for c in norm] == norm_headers:
                offset = 0  # header was included as row 1
                continue
            if idx == 0:
                offset = 1  # caller passed data rows only (first data row = Sheet row 2)
            sheet_row_num = idx + 1 + offset
            if is_blank_row(norm):
                continue
            parsed.append((sheet_row_num, norm))
        out[tab] = parsed
    return out


def row_key(tab: str, row: list[Any]) -> str:
    # Log tabs: ID is the last column. Staples: Slug is column 0.
    return str(row[0] if tab == "Staples" else row[-1]).strip()


def _float_or_none(val: Any) -> float | None:
    if val == "" or val is None:
        return None
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return float(val)
    try:
        return float(str(val).strip())
    except ValueError:
        return None


def _int_or_none(val: Any) -> int | None:
    f = _float_or_none(val)
    if f is None or not f.is_integer():
        return None
    return int(f)


def row_to_entry_payload(tab: str, row: list[Any]) -> tuple[str, dict[str, Any]] | tuple[None, str]:
    """Convert a normalized Sheet row from a log tab into (entry_type, payload) or (None, error)."""
    if tab not in TAB_TO_TYPE:
        return None, f"Unknown log tab {tab!r}"
    etype = TAB_TO_TYPE[tab]
    date_s = str(row[0]).strip()
    if not date_s:
        return None, "Missing Date in column A"

    def combine_when(d: str, t: str) -> str:
        ts = str(t).strip()
        return f"{d} {ts}" if ts else d

    if tab == "Workouts":
        kind = str(row[1]).strip().lower() or "solo"
        status = str(row[2]).strip().lower() or "attended"
        payload: dict[str, Any] = {"when": date_s, "kind": kind, "status": status}
        if row[3] != "":
            dur = _float_or_none(row[3])
            if dur is None:
                return None, f"Invalid Duration (min): {row[3]!r}"
            payload["duration_min"] = dur
        if row[4] != "":
            ex = _int_or_none(row[4])
            if ex is None:
                return None, f"Invalid Exercises: {row[4]!r}"
            payload["exercises"] = ex
        if row[5] != "":
            low = str(row[5]).strip().lower()
            if low in ("yes", "true", "1"):
                payload["fasted"] = True
            elif low in ("no", "false", "0"):
                payload["fasted"] = False
            else:
                return None, f"Invalid Fasted value: {row[5]!r}"
        if row[6]:
            payload["notes"] = str(row[6]).strip()
        return etype, payload

    if tab == "Meals":
        desc = str(row[3]).strip()
        kcal = _float_or_none(row[4])
        prot = _float_or_none(row[5])
        if not desc or kcal is None or prot is None:
            return None, "Meals row requires Description, Kcal (est), and Protein g (est)"
        payload = {
            "when": combine_when(date_s, str(row[1])),
            "description": desc,
            "kcal": kcal,
            "protein_g": prot,
            "estimated": True,
        }
        if row[2]:
            payload["slot"] = str(row[2]).strip().lower()
        if row[6]:
            payload["notes"] = str(row[6]).strip()
        return etype, payload

    if tab == "Weight":
        w_kg = _float_or_none(row[2])
        waist = _float_or_none(row[3])
        if w_kg is None and waist is None:
            return None, "Weight row requires Weight (kg) or Waist (in)"
        payload = {"when": combine_when(date_s, str(row[1]))}
        if w_kg is not None:
            payload["weight_kg"] = w_kg
        if waist is not None:
            payload["waist_in"] = waist
        if row[4]:
            payload["context"] = str(row[4]).strip()
        if row[5]:
            payload["notes"] = str(row[5]).strip()
        return etype, payload

    if tab == "CPAP":
        hrs = _float_or_none(row[1])
        if hrs is None:
            return None, "CPAP row requires numeric Hours"
        payload = {"when": date_s, "hours": hrs}
        if row[2] != "":
            ahi = _float_or_none(row[2])
            if ahi is None:
                return None, f"Invalid AHI: {row[2]!r}"
            payload["ahi"] = ahi
        if row[3] != "":
            mo = _int_or_none(row[3])
            if mo is None:
                return None, f"Invalid Mask-offs: {row[3]!r}"
            payload["mask_offs"] = mo
        if row[4]:
            payload["refreshed"] = str(row[4]).strip().lower()
        if row[5]:
            payload["notes"] = str(row[5]).strip()
        return etype, payload

    if tab == "Meds":
        name = str(row[2]).strip().lower()
        if not name:
            return None, "Meds row requires Name"
        payload = {
            "when": combine_when(date_s, str(row[1])),
            "name": name,
            "status": str(row[4]).strip().lower() or "taken",
        }
        if row[3]:
            payload["dose"] = str(row[3]).strip()
        if row[5]:
            payload["timing"] = str(row[5]).strip()
        if row[6]:
            payload["notes"] = str(row[6]).strip()
        return etype, payload

    if tab == "Slips":
        what = str(row[2]).strip()
        trig = str(row[3]).strip().lower()
        if not what or not trig:
            return None, "Slips row requires What and Trigger"
        payload = {
            "when": combine_when(date_s, str(row[1])),
            "what": what,
            "trigger": trig,
        }
        if row[4] != "":
            kc = _float_or_none(row[4])
            if kc is None:
                return None, f"Invalid Kcal (est): {row[4]!r}"
            payload["kcal_est"] = kc
        if row[5]:
            payload["notes"] = str(row[5]).strip()
        return etype, payload

    return None, f"Unhandled tab {tab!r}"


def row_to_staple_payload(row: list[Any]) -> tuple[str, dict[str, Any]] | tuple[None, str]:
    slug = str(row[0]).strip().lower()
    name = str(row[1]).strip()
    unit = str(row[2]).strip() or "serving"
    kcal = _float_or_none(row[3])
    prot = _float_or_none(row[4])
    if not slug or not name or kcal is None or prot is None:
        return None, "Staples row requires Slug, Name, numeric Kcal (est), and numeric Protein g (est)"
    payload: dict[str, Any] = {
        "name": name,
        "unit": unit,
        "kcal": round(kcal, 1),
        "protein_g": round(prot, 1),
        "estimated": True,
    }
    aliases = [a.strip().lower() for a in str(row[5]).split(",") if a.strip()]
    if aliases:
        payload["aliases"] = sorted(set(aliases))
    if row[6]:
        payload["notes"] = str(row[6]).strip()
    return slug, payload


def build_sync_plan(
    *,
    local_tabs: dict[str, list[list[Any]]],
    archived_ids: set[str],
    remote_tabs: dict[str, list[tuple[int, list[Any]]]],
    base_tabs: dict[str, dict[str, list[Any]]],
    headers_map: dict[str, list[str]],
    prefer: str | None = None,
) -> dict[str, Any]:
    """Compute a 3-way sync plan across all tabs present in `remote_tabs` (or all tabs if empty)."""
    push_append: list[dict[str, Any]] = []
    push_update: list[dict[str, Any]] = []
    remote_delete: list[dict[str, Any]] = []
    pull_add: list[dict[str, Any]] = []
    pull_update: list[dict[str, Any]] = []
    delete_local: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    invalid_remote_rows: list[dict[str, Any]] = []
    in_sync_count = 0

    tabs_to_check = [t for t in headers_map if t in remote_tabs]
    for tab in tabs_to_check:
        width = len(headers_map[tab])
        loc_map: dict[str, list[Any]] = {}
        for r in local_tabs.get(tab, []):
            nr = normalize_row(tab, r, width)
            k = row_key(tab, nr)
            if k:
                loc_map[k] = nr

        rem_map: dict[str, tuple[int, list[Any]]] = {}
        for sheet_row_num, nr in remote_tabs.get(tab, []):
            k = row_key(tab, nr)
            if not k:
                # Manual Sheet row with no ID yet
                res = row_to_staple_payload(nr) if tab == "Staples" else row_to_entry_payload(tab, nr)
                if res[0] is None:
                    invalid_remote_rows.append({
                        "tab": tab,
                        "remote_row_index": sheet_row_num,
                        "row": nr,
                        "error": res[1],
                    })
                else:
                    pull_add.append({
                        "tab": tab,
                        "remote_row_index": sheet_row_num,
                        "row": nr,
                        "has_id": False,
                    })
                continue
            if k in rem_map:
                invalid_remote_rows.append({
                    "tab": tab,
                    "remote_row_index": sheet_row_num,
                    "row": nr,
                    "error": f"Duplicate key {k!r} in remote tab {tab}",
                })
                continue
            rem_map[k] = (sheet_row_num, nr)

        base_map: dict[str, list[Any]] = {
            k: normalize_row(tab, v, width) for k, v in base_tabs.get(tab, {}).items()
        }

        all_keys = sorted(set(loc_map) | set(rem_map))
        for k in all_keys:
            in_loc = k in loc_map
            in_rem = k in rem_map
            in_base = k in base_map

            if in_loc and in_rem:
                sheet_row_num, rem_row = rem_map[k]
                loc_row = loc_map[k]
                if loc_row == rem_row:
                    in_sync_count += 1
                    continue
                if in_base and rem_row == base_map[k]:
                    push_update.append({"tab": tab, "id": k, "remote_row_index": sheet_row_num, "row": loc_row})
                elif in_base and loc_row == base_map[k]:
                    res = row_to_staple_payload(rem_row) if tab == "Staples" else row_to_entry_payload(tab, rem_row)
                    if res[0] is None:
                        invalid_remote_rows.append({
                            "tab": tab,
                            "remote_row_index": sheet_row_num,
                            "row": rem_row,
                            "error": res[1],
                        })
                    else:
                        pull_update.append({"tab": tab, "id": k, "remote_row_index": sheet_row_num, "row": rem_row})
                elif prefer == "local":
                    push_update.append({"tab": tab, "id": k, "remote_row_index": sheet_row_num, "row": loc_row})
                elif prefer == "remote":
                    res = row_to_staple_payload(rem_row) if tab == "Staples" else row_to_entry_payload(tab, rem_row)
                    if res[0] is None:
                        invalid_remote_rows.append({
                            "tab": tab,
                            "remote_row_index": sheet_row_num,
                            "row": rem_row,
                            "error": res[1],
                        })
                    else:
                        pull_update.append({"tab": tab, "id": k, "remote_row_index": sheet_row_num, "row": rem_row})
                else:
                    conflicts.append({
                        "tab": tab,
                        "id": k,
                        "remote_row_index": sheet_row_num,
                        "local_row": loc_row,
                        "remote_row": rem_row,
                        "base_row": base_map.get(k),
                    })

            elif in_loc and not in_rem:
                if in_base:
                    if prefer == "local":
                        push_append.append({"tab": tab, "id": k, "row": loc_map[k]})
                    else:
                        delete_local.append({"tab": tab, "id": k, "local_row": loc_map[k]})
                else:
                    push_append.append({"tab": tab, "id": k, "row": loc_map[k]})

            elif in_rem and not in_loc:
                sheet_row_num, rem_row = rem_map[k]
                if k in archived_ids or in_base:
                    if prefer == "remote":
                        res = row_to_staple_payload(rem_row) if tab == "Staples" else row_to_entry_payload(tab, rem_row)
                        if res[0] is None:
                            invalid_remote_rows.append({
                                "tab": tab,
                                "remote_row_index": sheet_row_num,
                                "row": rem_row,
                                "error": res[1],
                            })
                        else:
                            pull_add.append({
                                "tab": tab,
                                "id": k,
                                "remote_row_index": sheet_row_num,
                                "row": rem_row,
                                "has_id": True,
                            })
                    else:
                        remote_delete.append({"tab": tab, "id": k, "remote_row_index": sheet_row_num})
                else:
                    res = row_to_staple_payload(rem_row) if tab == "Staples" else row_to_entry_payload(tab, rem_row)
                    if res[0] is None:
                        invalid_remote_rows.append({
                            "tab": tab,
                            "remote_row_index": sheet_row_num,
                            "row": rem_row,
                            "error": res[1],
                        })
                    else:
                        pull_add.append({
                            "tab": tab,
                            "id": k,
                            "remote_row_index": sheet_row_num,
                            "row": rem_row,
                            "has_id": True,
                        })

    total_actions = (
        len(push_append)
        + len(push_update)
        + len(remote_delete)
        + len(pull_add)
        + len(pull_update)
        + len(delete_local)
        + len(conflicts)
        + len(invalid_remote_rows)
    )
    return {
        "tabs_checked": tabs_to_check,
        "clean": total_actions == 0,
        "counts": {
            "in_sync": in_sync_count,
            "push_append": len(push_append),
            "push_update": len(push_update),
            "remote_delete": len(remote_delete),
            "pull_add": len(pull_add),
            "pull_update": len(pull_update),
            "delete_local": len(delete_local),
            "conflicts": len(conflicts),
            "invalid_remote_rows": len(invalid_remote_rows),
        },
        "push_append": push_append,
        "push_update": push_update,
        "remote_delete": remote_delete,
        "pull_add": pull_add,
        "pull_update": pull_update,
        "delete_local": delete_local,
        "conflicts": conflicts,
        "invalid_remote_rows": invalid_remote_rows,
    }
