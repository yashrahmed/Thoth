"""CLI for declarative external tool/connector harness routing (`harnesses.toml`).

Subcommands:
- `validate` — strictly validate `harnesses.toml` (schema, aliases, providers, route keys)
- `list`     — list configured aliases and routes
- `resolve`  — deterministically resolve primary/fallback route, gates, rules, and delegate brief contract;
               appends structured telemetry to `<root>/.thoth-telemetry/harness-route.jsonl`
- `stats`    — summarize recent route resolutions, fallbacks, and blocks from telemetry
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tomllib
from collections import Counter
from datetime import timedelta
from pathlib import Path
from typing import Any

from thoth_core import fail, now_local, resolve_root, write_lock

CONFIG_FILE = "harnesses.toml"
TELEMETRY_REL = Path(".thoth-telemetry") / "harness-route.jsonl"

ALLOWED_TOP_KEYS = frozenset({"providers", "default", "aliases", "routes"})
ALLOWED_ENDPOINT_KEYS = frozenset({"provider", "model", "options"})
ALLOWED_ROUTE_KEYS = frozenset({
    "primary",
    "fallback",
    "aliases",
    "tools",
    "directions",
    "fallback_directions",
    "boundary",
    "when",
    "stay_native_if",
    "read_gate",
    "write_gate",
    "read_rules",
    "write_rules",
    "note",
    "read_note",
    "write_note",
    "fallback_note",
})
ALLOWED_OPS = frozenset({"read", "write"})
VALID_FALLBACK_REASONS = frozenset({"unavailable", "tool_absent", "auth_error", "connector_error"})
BLOCKED_FALLBACK_REASONS = frozenset({"empty_result"})
ALL_KNOWN_REASONS = VALID_FALLBACK_REASONS | BLOCKED_FALLBACK_REASONS
SPECIAL_ENDPOINTS = frozenset({"native", "none"})


def norm_key(name: str) -> str:
    return re.sub(r"[\s\-/]+", "_", name.strip().lower()).strip("_")


def parse_current(raw: str | None) -> tuple[str | None, str | None]:
    if not raw or not raw.strip():
        return None, None
    s = raw.strip()
    if "/" in s:
        provider, model = s.split("/", 1)
        return provider.strip() or None, model.strip() or None
    return s, None


def _validate_str_list(val: Any, ctx: str, *, allowed: frozenset[str] | None = None) -> list[str]:
    if not isinstance(val, list) or not all(isinstance(x, str) and x.strip() for x in val):
        raise ValueError(f"{ctx} must be a list of non-empty strings")
    out = [x.strip() for x in val]
    if allowed is not None:
        bad = [x for x in out if x not in allowed]
        if bad:
            raise ValueError(f"{ctx} contains invalid value(s): {', '.join(bad)} (allowed: {', '.join(sorted(allowed))})")
    return out


def _validate_endpoint_obj(obj: Any, ctx: str, providers: set[str] | None) -> dict[str, Any]:
    if not isinstance(obj, dict):
        raise ValueError(f"{ctx} must be a table with at least 'provider'")
    unknown = sorted(set(obj.keys()) - ALLOWED_ENDPOINT_KEYS)
    if unknown:
        raise ValueError(f"{ctx} has unknown key(s): {', '.join(unknown)}")
    provider = obj.get("provider")
    if not isinstance(provider, str) or not provider.strip():
        raise ValueError(f"{ctx}.provider must be a non-empty string")
    provider = provider.strip()
    if providers is not None and provider not in providers:
        raise ValueError(f"{ctx}.provider {provider!r} is not in top-level providers ({sorted(providers)})")
    ep: dict[str, Any] = {"provider": provider}
    if "model" in obj:
        model = obj["model"]
        if not isinstance(model, str) or not model.strip():
            raise ValueError(f"{ctx}.model must be a non-empty string")
        ep["model"] = model.strip()
    if "options" in obj:
        opts = obj["options"]
        if not isinstance(opts, dict):
            raise ValueError(f"{ctx}.options must be a table")
        ep["options"] = opts
    return ep


def _resolve_endpoint_ref(
    raw: Any,
    ctx: str,
    aliases: dict[str, dict[str, Any]],
    providers: set[str] | None,
) -> dict[str, Any]:
    if isinstance(raw, str):
        s = raw.strip()
        if s in SPECIAL_ENDPOINTS:
            return {"kind": s}
        if s in aliases:
            return {"kind": "endpoint", "alias": s, **aliases[s]}
        raise ValueError(f"{ctx} references unknown alias {s!r} (known: {sorted(aliases)} or 'native'/'none')")
    if isinstance(raw, dict):
        return {"kind": "endpoint", **_validate_endpoint_obj(raw, ctx, providers)}
    raise ValueError(f"{ctx} must be 'native', 'none', an alias name, or an inline endpoint table")


def load_config(root: Path) -> tuple[dict[str, Any] | None, list[str]]:
    """Load and validate `<root>/harnesses.toml`. Returns `(parsed_or_none, errors)`."""
    cfg_path = root / CONFIG_FILE
    if not cfg_path.exists():
        return None, []
    try:
        raw = tomllib.loads(cfg_path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as e:
        return None, [f"Failed to parse {CONFIG_FILE}: {e}"]

    errors: list[str] = []
    unknown_top = sorted(set(raw.keys()) - ALLOWED_TOP_KEYS)
    if unknown_top:
        errors.append(f"Unknown top-level key(s): {', '.join(unknown_top)}")

    providers_list: list[str] | None = None
    providers_set: set[str] | None = None
    if "providers" in raw:
        try:
            providers_list = _validate_str_list(raw["providers"], "providers")
            providers_set = set(providers_list)
        except ValueError as e:
            errors.append(str(e))

    aliases: dict[str, dict[str, Any]] = {}
    raw_aliases = raw.get("aliases", {})
    if not isinstance(raw_aliases, dict):
        errors.append("aliases must be a table")
    else:
        for name, spec in raw_aliases.items():
            if name in SPECIAL_ENDPOINTS:
                errors.append(f"Alias name {name!r} is reserved")
                continue
            try:
                aliases[name] = _validate_endpoint_obj(spec, f"aliases.{name}", providers_set)
            except ValueError as e:
                errors.append(str(e))

    default_spec: dict[str, Any] = {"kind": "native_or_block"}
    if "default" in raw:
        d = raw["default"]
        if isinstance(d, str) and d.strip() in ("native_or_block", "block"):
            default_spec = {"kind": d.strip()}
        else:
            try:
                default_spec = _resolve_endpoint_ref(d, "default", aliases, providers_set)
            except ValueError as e:
                errors.append(str(e))

    routes: dict[str, dict[str, Any]] = {}
    alias_index: dict[str, str] = {}
    raw_routes = raw.get("routes", {})
    if not isinstance(raw_routes, dict):
        errors.append("routes must be a table")
    else:
        for cap_name, r in raw_routes.items():
            canonical = norm_key(cap_name)
            if not canonical:
                errors.append(f"Invalid empty route name {cap_name!r}")
                continue
            if canonical in routes:
                errors.append(f"Duplicate route name after normalization: {cap_name!r}")
                continue
            if not isinstance(r, dict):
                errors.append(f"routes.{cap_name} must be a table")
                continue
            unknown_r = sorted(set(r.keys()) - ALLOWED_ROUTE_KEYS)
            if unknown_r:
                errors.append(f"routes.{cap_name} has unknown key(s): {', '.join(unknown_r)}")
            if "primary" not in r:
                errors.append(f"routes.{cap_name} is missing required key 'primary'")
                continue
            try:
                primary = _resolve_endpoint_ref(r["primary"], f"routes.{cap_name}.primary", aliases, providers_set)
                fallback = (
                    _resolve_endpoint_ref(r["fallback"], f"routes.{cap_name}.fallback", aliases, providers_set)
                    if "fallback" in r
                    else {"kind": "none"}
                )
                directions = (
                    _validate_str_list(r["directions"], f"routes.{cap_name}.directions", allowed=ALLOWED_OPS)
                    if "directions" in r
                    else ["read", "write"]
                )
                fallback_directions = (
                    _validate_str_list(
                        r["fallback_directions"], f"routes.{cap_name}.fallback_directions", allowed=ALLOWED_OPS
                    )
                    if "fallback_directions" in r
                    else list(directions)
                )
                route_aliases = (
                    _validate_str_list(r["aliases"], f"routes.{cap_name}.aliases") if "aliases" in r else []
                )
                tools = _validate_str_list(r["tools"], f"routes.{cap_name}.tools") if "tools" in r else []
                read_rules = (
                    _validate_str_list(r["read_rules"], f"routes.{cap_name}.read_rules") if "read_rules" in r else []
                )
                write_rules = (
                    _validate_str_list(r["write_rules"], f"routes.{cap_name}.write_rules") if "write_rules" in r else []
                )
                for str_field in ("boundary", "when", "stay_native_if", "read_gate", "write_gate", "note", "read_note", "write_note", "fallback_note"):
                    if str_field in r and (not isinstance(r[str_field], str) or not r[str_field].strip()):
                        raise ValueError(f"routes.{cap_name}.{str_field} must be a non-empty string")
            except ValueError as e:
                errors.append(str(e))
                continue

            for a in route_aliases:
                nk = norm_key(a)
                if nk in alias_index or nk in routes:
                    errors.append(f"routes.{cap_name}.aliases entry {a!r} collides with another route or alias")
                else:
                    alias_index[nk] = canonical

            routes[canonical] = {
                "capability": canonical,
                "primary": primary,
                "fallback": fallback,
                "aliases": route_aliases,
                "tools": tools,
                "directions": directions,
                "fallback_directions": fallback_directions,
                "boundary": r.get("boundary"),
                "when": r.get("when"),
                "stay_native_if": r.get("stay_native_if"),
                "read_gate": r.get("read_gate"),
                "write_gate": r.get("write_gate", "explicit_approval_or_rule"),
                "read_rules": read_rules,
                "write_rules": write_rules,
                "note": r.get("note"),
                "read_note": r.get("read_note"),
                "write_note": r.get("write_note"),
                "fallback_note": r.get("fallback_note"),
            }

    # Check collisions between route canonical names and aliases registered earlier
    for cap in routes:
        if cap in alias_index and alias_index[cap] != cap:
            errors.append(f"Route {cap!r} collides with alias on route {alias_index[cap]!r}")

    if errors:
        return None, errors

    return {
        "providers": providers_list or [],
        "default": default_spec,
        "aliases": aliases,
        "routes": routes,
        "alias_index": alias_index,
    }, []


def _format_target(ep: dict[str, Any]) -> dict[str, Any]:
    target: dict[str, Any] = {"providerInstanceId": ep["provider"]}
    if "model" in ep:
        target["model"] = ep["model"]
    if "options" in ep:
        target["options"] = ep["options"]
    return target


def _target_label(ep: dict[str, Any] | None) -> str | None:
    if not ep:
        return None
    if ep.get("kind") != "endpoint":
        return ep.get("kind")
    return f"{ep['provider']}/{ep['model']}" if "model" in ep else ep["provider"]


def _build_gates(op: str, route: dict[str, Any] | None) -> list[str]:
    gates: list[str] = []
    if op == "read":
        rg = route.get("read_gate") if route else None
        if rg and rg != "none":
            gates.append(rg)
    else:
        wg = route.get("write_gate", "explicit_approval_or_rule") if route else "explicit_approval_or_rule"
        if wg and wg != "none":
            gates.append(wg)
        gates.extend(["readback_verify", "no_blind_retry_on_uncertain_failure"])
    return gates


def _brief_required(op: str) -> list[str]:
    base = [
        "assigned_route_native_only",
        "exact_target",
        "boundary",
        "steps",
        "return_fields",
        "skip_unrelated_reads",
    ]
    if op == "read":
        base.append("mark_read_only")
    else:
        base.extend(["exact_payload", "approval_or_verified_rule_id", "return_readback_values"])
    return base


def _append_telemetry(root: Path, event: dict[str, Any]) -> None:
    log_path = root / TELEMETRY_REL
    line = json.dumps(event, ensure_ascii=False) + "\n"
    with write_lock(log_path.parent):
        with open(log_path, "a", encoding="utf-8") as fh:
            fh.write(line)


def cmd_validate(root: Path, _args: argparse.Namespace) -> None:
    cfg_path = root / CONFIG_FILE
    if not cfg_path.exists():
        fail(f"No {CONFIG_FILE} found in {root}")
    cfg, errors = load_config(root)
    if errors or cfg is None:
        print(json.dumps({"ok": False, "file": str(cfg_path), "errors": errors}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    print(json.dumps({
        "ok": True,
        "file": str(cfg_path),
        "providers": cfg["providers"],
        "aliases": sorted(cfg["aliases"].keys()),
        "routes": sorted(cfg["routes"].keys()),
    }, ensure_ascii=False))


def cmd_list(root: Path, _args: argparse.Namespace) -> None:
    cfg, errors = load_config(root)
    if errors:
        fail("; ".join(errors))
    if cfg is None:
        print(json.dumps({"ok": True, "config_present": False, "routes": []}, ensure_ascii=False))
        return
    items = []
    for cap, r in cfg["routes"].items():
        items.append({
            "capability": cap,
            "aliases": r["aliases"],
            "primary": _target_label(r["primary"]),
            "fallback": _target_label(r["fallback"]),
            "directions": r["directions"],
            "boundary": r["boundary"],
        })
    print(json.dumps({
        "ok": True,
        "config_present": True,
        "providers": cfg["providers"],
        "aliases": cfg["aliases"],
        "routes": items,
    }, ensure_ascii=False))


def _resolve_endpoint_action(
    ep: dict[str, Any],
    *,
    tier: str,
    cur_provider: str | None,
    cur_model: str | None,
    assigned_route: bool,
    stay_native: bool,
    route: dict[str, Any] | None,
) -> tuple[str, dict[str, Any] | None, str | None]:
    """Return `(action, target, reason_note)` for a chosen endpoint."""
    kind = ep["kind"]
    if kind == "none":
        return "block", None, f"no_{tier}_configured"
    if kind == "native":
        return "native", None, "route_is_native"
    if kind == "block":
        return "block", None, "default_block"
    if kind == "native_or_block":
        return "native_or_block", None, "unlisted_default"

    if tier == "primary":
        if assigned_route:
            return "native", None, "route_assigned_delegate"
        if stay_native and route and route.get("stay_native_if"):
            return "native", None, "stay_native_condition_met"
        if cur_provider and cur_provider == ep["provider"]:
            if "model" not in ep or cur_model == ep["model"]:
                return "native", None, "current_matches_primary"
        return "delegate", _format_target(ep), "delegate_to_primary"

    # Fallback matches on provider alone
    if cur_provider and cur_provider == ep["provider"]:
        return "native", None, "current_provider_matches_fallback"
    return "delegate", _format_target(ep), "delegate_to_fallback"


def cmd_resolve(root: Path, args: argparse.Namespace) -> None:
    cfg, errors = load_config(root)
    if errors:
        fail("; ".join(errors))

    op = args.op
    req_cap = norm_key(args.capability)
    if not req_cap:
        fail("Capability must not be empty")

    cur_provider, cur_model = parse_current(args.current)
    is_fallback = bool(args.fallback)
    reason = args.reason.strip().lower() if args.reason else None

    if is_fallback:
        if not reason:
            fail(f"--fallback requires --reason ({', '.join(sorted(ALL_KNOWN_REASONS))})")
        if reason not in ALL_KNOWN_REASONS:
            fail(f"Unknown --reason {reason!r}. Allowed: {', '.join(sorted(ALL_KNOWN_REASONS))}")
    elif reason is not None:
        fail("--reason is only valid with --fallback")

    route: dict[str, Any] | None = None
    canonical = req_cap
    if cfg is not None:
        canonical = cfg["alias_index"].get(req_cap, req_cap)
        route = cfg["routes"].get(canonical)

    result: dict[str, Any] = {
        "ok": True,
        "capability": canonical,
        "requested": args.capability,
        "op": op,
        "tier": "fallback" if is_fallback else "primary",
        "config_present": cfg is not None,
        "route_found": route is not None,
    }

    chosen_ep: dict[str, Any] | None = None
    action: str
    target: dict[str, Any] | None = None
    resolution_note: str | None = None

    if route is None:
        default_ep = cfg["default"] if cfg is not None else {"kind": "native_or_block"}
        chosen_ep = default_ep
        action, target, resolution_note = _resolve_endpoint_action(
            default_ep,
            tier="primary",
            cur_provider=cur_provider,
            cur_model=cur_model,
            assigned_route=args.assigned_route,
            stay_native=False,
            route=None,
        )
    elif op not in route["directions"]:
        action, target, resolution_note = "block", None, "direction_not_allowed"
    elif is_fallback:
        if reason in BLOCKED_FALLBACK_REASONS:
            action, target, resolution_note = "block", None, f"fallback_forbidden_on_{reason}"
        elif op not in route["fallback_directions"]:
            action, target, resolution_note = "block", None, "fallback_direction_not_allowed"
        else:
            chosen_ep = route["fallback"]
            action, target, resolution_note = _resolve_endpoint_action(
                chosen_ep,
                tier="fallback",
                cur_provider=cur_provider,
                cur_model=cur_model,
                assigned_route=False,
                stay_native=False,
                route=route,
            )
    else:
        chosen_ep = route["primary"]
        action, target, resolution_note = _resolve_endpoint_action(
            chosen_ep,
            tier="primary",
            cur_provider=cur_provider,
            cur_model=cur_model,
            assigned_route=args.assigned_route,
            stay_native=args.stay_native,
            route=route,
        )

    result["action"] = action
    if resolution_note:
        result["resolution"] = resolution_note
    if target is not None:
        result["target"] = target
        result["match_mode"] = "provider_only" if is_fallback else "provider_and_model"
    if route is not None:
        if route["boundary"]:
            result["boundary"] = route["boundary"]
        if route["tools"]:
            result["tools"] = route["tools"]
        rules = route["read_rules"] if op == "read" else route["write_rules"]
        if rules:
            result["rules"] = rules
        notes: list[str] = []
        for field in ("when", "stay_native_if", "note", "read_note" if op == "read" else "write_note"):
            if route.get(field):
                notes.append(f"{field}: {route[field]}" if field in ("when", "stay_native_if") else route[field])
        if is_fallback and route.get("fallback_note"):
            notes.append(f"fallback: {route['fallback_note']}")
        if notes:
            result["notes"] = notes
    elif cfg is None:
        result["notes"] = [f"No {CONFIG_FILE} in instance root; run natively if capable (obeying gates) or stop and report."]

    result["gates"] = _build_gates(op, route)
    if action == "delegate":
        result["brief_required"] = _brief_required(op)
    if is_fallback:
        result["fallback_reason"] = reason
        if reason in VALID_FALLBACK_REASONS:
            result["drift_report"] = f"Primary route failed/unavailable ({reason}); report drift and offer to update {CONFIG_FILE} (never edit silently)."

    if not args.no_log:
        _append_telemetry(root, {
            "ts": now_local().isoformat(),
            "capability": canonical,
            "op": op,
            "current": args.current,
            "tier": result["tier"],
            "action": action,
            "resolution": resolution_note,
            "target": _target_label(chosen_ep) if action == "delegate" else None,
            "fallback_reason": reason,
            "route_found": route is not None,
        })

    print(json.dumps(result, ensure_ascii=False))


def cmd_stats(root: Path, args: argparse.Namespace) -> None:
    log_path = root / TELEMETRY_REL
    if not log_path.exists():
        print(json.dumps({"ok": True, "total": 0, "by_capability": {}, "by_action": {}, "fallbacks": 0, "fallback_reasons": {}, "blocks": 0}, ensure_ascii=False))
        return

    cutoff = now_local() - timedelta(days=args.days) if args.days and args.days > 0 else None
    by_cap: Counter[str] = Counter()
    by_action: Counter[str] = Counter()
    fb_reasons: Counter[str] = Counter()
    total = 0
    fallbacks = 0
    blocks = 0
    unlisted = 0

    for line in log_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if cutoff is not None:
            ts_str = ev.get("ts")
            try:
                from datetime import datetime
                if datetime.fromisoformat(ts_str) < cutoff:
                    continue
            except Exception:
                continue
        total += 1
        by_cap[str(ev.get("capability", "unknown"))] += 1
        act = str(ev.get("action", "unknown"))
        by_action[act] += 1
        if act == "block":
            blocks += 1
        if not ev.get("route_found", True):
            unlisted += 1
        if ev.get("tier") == "fallback":
            fallbacks += 1
            if ev.get("fallback_reason"):
                fb_reasons[str(ev["fallback_reason"])] += 1

    print(json.dumps({
        "ok": True,
        "days": args.days if args.days and args.days > 0 else "all",
        "total": total,
        "by_capability": dict(by_cap.most_common()),
        "by_action": dict(by_action.most_common()),
        "fallbacks": fallbacks,
        "fallback_reasons": dict(fb_reasons.most_common()),
        "blocks": blocks,
        "unlisted": unlisted,
    }, ensure_ascii=False))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="harness-route", description="Declarative external harness router & telemetry.")
    p.add_argument("--root", help="Instance root directory (default: current working directory).")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("validate", help="Strictly validate harnesses.toml.")
    sub.add_parser("list", help="List configured aliases and routes.")

    res = sub.add_parser("resolve", help="Resolve permitted route, gates, and brief contract for an external capability.")
    res.add_argument("capability", help="Capability name or alias (e.g. gmail, sheets, integrated_browser).")
    res.add_argument("--op", required=True, choices=["read", "write"], help="Operation direction.")
    res.add_argument("--current", help="Current harness as '<provider>/<model>' or '<provider>'.")
    res.add_argument("--assigned-route", action="store_true", help="Caller prompt explicitly assigned this route as a delegate.")
    res.add_argument("--stay-native", action="store_true", help="Route's stay_native_if condition holds.")
    res.add_argument("--fallback", action="store_true", help="Resolve fallback after primary was unavailable or failed.")
    res.add_argument("--reason", help="Failure/unavailability reason (required with --fallback).")
    res.add_argument("--no-log", action="store_true", help="Do not append to telemetry log.")

    st = sub.add_parser("stats", help="Summarize harness routing and fallback telemetry.")
    st.add_argument("--days", type=int, default=30, help="Window in days (0 = all time; default 30).")

    return p


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    root = resolve_root(args.root, "harness-route", allow_worktree=True)
    dispatch = {
        "validate": cmd_validate,
        "list": cmd_list,
        "resolve": cmd_resolve,
        "stats": cmd_stats,
    }
    dispatch[args.cmd](root, args)


if __name__ == "__main__":
    main()
