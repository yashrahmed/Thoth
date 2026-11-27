"""CLI for declarative top-level thread creation planning (`thread-plan`).

Reads optional `[threads]` from `<root>/thoth.toml`:
- `title_prefix`: applied idempotently (once) to new thread titles
- `default_model`: `{ provider, model, label?, options? }` used when no model is requested
- `workspace_default`: default workspace mode (default: `"local"`)

Subcommands:
- `validate` — strictly validate `[threads]` in `thoth.toml`
- `prepare`  — compute normalized title, model selection, starter prompt framing,
               idempotency key (`client_request_id`), and report contract; logs telemetry
- `stats`    — summarize thread-plan usage and model-source breakdown
"""

from __future__ import annotations

import argparse
import json
import secrets
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from thoth_core import (
    TELEMETRY_DIR,
    THOTH_CONFIG_FILE,
    append_telemetry,
    fail,
    load_thoth_toml,
    now_local,
    resolve_root,
)

TELEMETRY_FILE = "thread-plan.jsonl"
ALLOWED_SECTION_KEYS = frozenset({"title_prefix", "default_model", "workspace_default"})
ALLOWED_MODEL_KEYS = frozenset({"provider", "model", "label", "options"})


def load_threads_config(root: Path) -> tuple[dict[str, Any], list[str]]:
    raw, parse_err = load_thoth_toml(root)
    if parse_err:
        return {}, [parse_err]
    if raw is None or "threads" not in raw:
        return {"title_prefix": "", "default_model": None, "workspace_default": "local"}, []

    sec = raw["threads"]
    if not isinstance(sec, dict):
        return {}, ["[threads] must be a table"]

    errors: list[str] = []
    unknown = sorted(set(sec.keys()) - ALLOWED_SECTION_KEYS)
    if unknown:
        errors.append(f"[threads] has unknown key(s): {', '.join(unknown)}")

    title_prefix = ""
    if "title_prefix" in sec:
        tp = sec["title_prefix"]
        if not isinstance(tp, str):
            errors.append("[threads].title_prefix must be a string")
        else:
            title_prefix = tp

    workspace_default = "local"
    if "workspace_default" in sec:
        wd = sec["workspace_default"]
        if not isinstance(wd, str) or not wd.strip():
            errors.append("[threads].workspace_default must be a non-empty string")
        else:
            workspace_default = wd.strip()

    default_model: dict[str, Any] | None = None
    if "default_model" in sec:
        dm = sec["default_model"]
        if not isinstance(dm, dict):
            errors.append("[threads].default_model must be a table")
        else:
            unknown_m = sorted(set(dm.keys()) - ALLOWED_MODEL_KEYS)
            if unknown_m:
                errors.append(f"[threads].default_model has unknown key(s): {', '.join(unknown_m)}")
            provider = dm.get("provider")
            model = dm.get("model")
            if not isinstance(provider, str) or not provider.strip():
                errors.append("[threads].default_model.provider must be a non-empty string")
            if not isinstance(model, str) or not model.strip():
                errors.append("[threads].default_model.model must be a non-empty string")
            if "label" in dm and (not isinstance(dm["label"], str) or not dm["label"].strip()):
                errors.append("[threads].default_model.label must be a non-empty string")
            if "options" in dm and not isinstance(dm["options"], dict):
                errors.append("[threads].default_model.options must be a table")
            if not errors:
                default_model = {"provider": provider.strip(), "model": model.strip()}
                if "label" in dm:
                    default_model["label"] = dm["label"].strip()
                if "options" in dm:
                    default_model["options"] = dm["options"]

    return {
        "title_prefix": title_prefix,
        "default_model": default_model,
        "workspace_default": workspace_default,
    }, errors


def apply_prefix_once(title: str, prefix: str) -> str:
    clean_title = title.strip()
    if not prefix:
        return clean_title
    if clean_title.lower().startswith(prefix.strip().lower()):
        # Preserve canonical prefix casing without doubling
        rest = clean_title[len(prefix.strip()) :].lstrip(" ")
        return f"{prefix}{rest}" if rest else clean_title
    return f"{prefix}{clean_title}"


def cmd_validate(root: Path, _args: argparse.Namespace) -> None:
    cfg, errors = load_threads_config(root)
    if errors:
        print(json.dumps({"ok": False, "file": str(root / THOTH_CONFIG_FILE), "errors": errors}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
    print(json.dumps({
        "ok": True,
        "config_present": (root / THOTH_CONFIG_FILE).exists(),
        **cfg,
    }, ensure_ascii=False))


def cmd_prepare(root: Path, args: argparse.Namespace) -> None:
    cfg, errors = load_threads_config(root)
    if errors:
        fail("; ".join(errors))

    raw_title = (args.title or "").strip()
    raw_task = (args.task or "").strip()
    prefix = cfg["title_prefix"]

    if not raw_title and not raw_task:
        if not args.no_log:
            append_telemetry(root, TELEMETRY_FILE, {
                "ts": now_local().isoformat(),
                "action": "ask",
                "reason": "missing_title_and_task",
                "model_source": None,
            })
        print(json.dumps({
            "ok": True,
            "action": "ask",
            "missing": ["title_or_task"],
            "note": "Ask the user for a title or task before creating a thread.",
        }, ensure_ascii=False))
        return

    if raw_title:
        title: str | None = apply_prefix_once(raw_title, prefix)
        title_needs_derivation = False
    else:
        title = None
        title_needs_derivation = True

    # Model resolution: explicit --host-default > explicit --model/--provider > instance default > host default
    if args.host_default and (args.model or args.provider):
        fail("Cannot combine --host-default with --model or --provider")

    model_selection: dict[str, Any] | None = None
    requested_model: dict[str, Any] | None = None
    if args.host_default:
        model_source = "host_default"
    elif args.model or args.provider:
        model_source = "requested"
        requested_model = {}
        if args.provider:
            requested_model["provider"] = args.provider.strip()
        if args.model:
            requested_model["model"] = args.model.strip()
        if args.effort:
            requested_model["effort"] = args.effort.strip()
    elif cfg["default_model"] is not None:
        model_source = "instance_default"
        model_selection = dict(cfg["default_model"])
        if args.effort:
            model_selection["requested_effort"] = args.effort.strip()
    else:
        model_source = "host_default"
        if args.effort:
            requested_model = {"effort": args.effort.strip()}

    # Prompt framing
    if raw_task:
        prompt_mode = "task"
        starter_prompt = raw_task
        prompt_note = "Frame as a standalone top-level thread (not a child delegate, so it may delegate if needed). Include only task-relevant context; never copy unrelated history."
    else:
        prompt_mode = "title_only"
        starter_prompt = f"Standalone top-level thread for {title!r}. Wait for the user's task; do not invent work."
        prompt_note = "Title-only thread: pass starter_prompt (or omit message if the host supports idle threads) and do not invent work."

    destination: dict[str, Any] = {
        "host": args.host.strip() if args.host else "active",
        "workspace": args.workspace.strip() if args.workspace else cfg["workspace_default"],
        "projectless": bool(args.projectless),
    }
    if args.project:
        destination["project"] = args.project.strip()

    client_request_id = f"thread-{secrets.token_hex(6)}"

    plan: dict[str, Any] = {
        "ok": True,
        "action": "create",
        "client_request_id": client_request_id,
        "title": title,
        "title_prefix": prefix,
        "title_needs_derivation": title_needs_derivation,
        "prompt_mode": prompt_mode,
        "starter_prompt": starter_prompt,
        "prompt_note": prompt_note,
        "fresh_history": not bool(args.fork),
        "destination": destination,
        "model_source": model_source,
        "verify_live_catalog": True,
        "report_required": ["title", "state", "model_and_effort_or_configured_default", "verbatim_link"],
    }
    if model_selection is not None:
        plan["model_selection"] = model_selection
    if requested_model is not None:
        plan["requested_model"] = requested_model

    if not args.no_log:
        append_telemetry(root, TELEMETRY_FILE, {
            "ts": now_local().isoformat(),
            "action": "create",
            "model_source": model_source,
            "prompt_mode": prompt_mode,
            "fork": bool(args.fork),
            "workspace": destination["workspace"],
            "projectless": bool(args.projectless),
        })

    print(json.dumps(plan, ensure_ascii=False))


def cmd_stats(root: Path, args: argparse.Namespace) -> None:
    log_path = root / TELEMETRY_DIR / TELEMETRY_FILE
    if not log_path.exists():
        print(json.dumps({"ok": True, "total": 0, "by_action": {}, "by_model_source": {}, "by_workspace": {}}, ensure_ascii=False))
        return

    cutoff = now_local() - timedelta(days=args.days) if args.days and args.days > 0 else None
    by_action: Counter[str] = Counter()
    by_model_source: Counter[str] = Counter()
    by_workspace: Counter[str] = Counter()
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
        by_action[str(ev.get("action", "unknown"))] += 1
        if ev.get("model_source"):
            by_model_source[str(ev["model_source"])] += 1
        if ev.get("workspace"):
            by_workspace[str(ev["workspace"])] += 1

    print(json.dumps({
        "ok": True,
        "days": args.days if args.days and args.days > 0 else "all",
        "total": total,
        "by_action": dict(by_action.most_common()),
        "by_model_source": dict(by_model_source.most_common()),
        "by_workspace": dict(by_workspace.most_common()),
    }, ensure_ascii=False))


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="thread-plan", description="Declarative top-level thread creation planner & telemetry.")
    p.add_argument("--root", help="Instance root directory (default: current working directory).")
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("validate", help="Validate [threads] config in thoth.toml.")

    prep = sub.add_parser("prepare", help="Prepare normalized title, model selection, prompt framing, and idempotency key.")
    prep.add_argument("--title", help="Requested thread title (prefix applied idempotently).")
    prep.add_argument("--task", help="Requested work/prompt for the new thread.")
    prep.add_argument("--model", help="Explicitly requested model name or ID.")
    prep.add_argument("--provider", help="Explicitly requested provider ID.")
    prep.add_argument("--effort", help="Explicitly requested reasoning/effort level.")
    prep.add_argument("--host-default", action="store_true", help="User explicitly asked for the host's configured default model.")
    prep.add_argument("--host", help="Explicit target host/machine if different from active.")
    prep.add_argument("--project", help="Explicit target project.")
    prep.add_argument("--projectless", action="store_true", help="Non-project / scratch thread.")
    prep.add_argument("--workspace", help="Workspace mode (e.g. local, worktree, cloud).")
    prep.add_argument("--fork", action="store_true", help="Fork requested instead of fresh history.")
    prep.add_argument("--no-log", action="store_true", help="Do not append to telemetry log.")

    st = sub.add_parser("stats", help="Summarize thread-plan telemetry.")
    st.add_argument("--days", type=int, default=30, help="Window in days (0 = all time; default 30).")

    return p


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    root = resolve_root(args.root, "thread-plan")
    dispatch = {
        "validate": cmd_validate,
        "prepare": cmd_prepare,
        "stats": cmd_stats,
    }
    dispatch[args.cmd](root, args)


if __name__ == "__main__":
    main()
