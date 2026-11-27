"""Tests for the harness-route CLI: validation, routing, fallbacks, gates, aliases, telemetry."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]

SAMPLE_TOML = """\
providers = ["codex", "claudeAgent", "antigravity"]

[aliases]
terra  = { provider = "codex",       model = "gpt-6.1-terra" }
sol    = { provider = "codex",       model = "gpt-6.2-sol", options = { reasoningEffort = "medium" } }
sonnet = { provider = "claudeAgent", model = "claude-sonnet-5-5" }

[routes.integrated_browser]
primary = "terra"
fallback = "native"
aliases = ["browser", "preview"]
tools = ["preview_*"]
when = "browser work needed (asked, fetch blocked/403, live forms)"
stay_native_if = "tab already open/shared in this thread"

[routes.desktop_chrome]
primary = "sonnet"
fallback = "terra"
aliases = ["chrome"]
boundary = "logged-in Chrome; own tab group"
read_gate = "explicit_request"
fallback_note = "only when Chrome is idle"

[routes.gmail]
primary = "sol"
fallback = "sonnet"
aliases = ["email"]
boundary = "owner@example.com only"
write_note = "send only if approval says send; else show draft in chat"

[routes.google_calendar]
primary = "sol"
fallback = "sonnet"
aliases = ["calendar", "gcal"]
boundary = "primary personal calendar only"
write_rules = ["20261123-124416-d7ca"]

[routes.read_only_feed]
primary = "sol"
fallback = "sonnet"
directions = ["read"]

[routes.no_write_fallback]
primary = "sol"
fallback = "sonnet"
fallback_directions = ["read"]
"""


def run_cli(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    env = {**os.environ, "THOTH_TZ": "America/Chicago"}
    proc = subprocess.run(
        ["uv", "run", "-q", "--directory", str(ENGINE_DIR), "harness-route", "--root", str(root), *args],
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    if check and proc.returncode != 0:
        raise AssertionError(f"CLI failed ({proc.returncode}): {args}\nstdout={proc.stdout}\nstderr={proc.stderr}")
    return proc


def j(proc: subprocess.CompletedProcess) -> dict:
    return json.loads(proc.stdout)


class TestHarnessRouteCLI(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "harnesses.toml").write_text(SAMPLE_TOML, encoding="utf-8")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_validate_and_list(self) -> None:
        val = j(run_cli(self.root, "validate"))
        self.assertTrue(val["ok"])
        self.assertIn("gmail", val["routes"])
        listed = j(run_cli(self.root, "list"))
        self.assertTrue(listed["config_present"])
        self.assertEqual(len(listed["routes"]), 6)

    def test_primary_delegate_and_native_match(self) -> None:
        # Non-matching current harness -> delegate with pinned options and write gates
        res = j(run_cli(self.root, "resolve", "gmail", "--op", "write", "--current", "antigravity/gemini-4-neon"))
        self.assertEqual(res["action"], "delegate")
        self.assertEqual(res["target"], {
            "providerInstanceId": "codex",
            "model": "gpt-6.2-sol",
            "options": {"reasoningEffort": "medium"},
        })
        self.assertEqual(res["boundary"], "owner@example.com only")
        self.assertIn("explicit_approval_or_rule", res["gates"])
        self.assertIn("readback_verify", res["gates"])
        self.assertIn("exact_payload", res["brief_required"])

        # Exact provider+model match -> native
        nat = j(run_cli(self.root, "resolve", "email", "--op", "read", "--current", "codex/gpt-6.2-sol"))
        self.assertEqual(nat["capability"], "gmail")
        self.assertEqual(nat["action"], "native")
        self.assertEqual(nat["gates"], [])

        # Same provider, wrong pinned model -> still delegates for primary
        wrong_model = j(run_cli(self.root, "resolve", "gmail", "--op", "read", "--current", "codex/gpt-6.1-terra"))
        self.assertEqual(wrong_model["action"], "delegate")
        self.assertEqual(wrong_model["target"]["model"], "gpt-6.2-sol")

    def test_stay_native_and_assigned_route(self) -> None:
        stay = j(run_cli(
            self.root, "resolve", "browser", "--op", "read",
            "--current", "antigravity/gemini-4-neon", "--stay-native",
        ))
        self.assertEqual(stay["capability"], "integrated_browser")
        self.assertEqual(stay["action"], "native")
        self.assertEqual(stay["resolution"], "stay_native_condition_met")

        assigned = j(run_cli(
            self.root, "resolve", "gmail", "--op", "read",
            "--current", "antigravity/gemini-4-neon", "--assigned-route",
        ))
        self.assertEqual(assigned["action"], "native")
        self.assertEqual(assigned["resolution"], "route_assigned_delegate")

    def test_read_gate_and_write_rules(self) -> None:
        chrome = j(run_cli(self.root, "resolve", "chrome", "--op", "read", "--current", "antigravity/gemini-4-neon"))
        self.assertEqual(chrome["action"], "delegate")
        self.assertEqual(chrome["gates"], ["explicit_request"])
        self.assertIn("mark_read_only", chrome["brief_required"])

        cal = j(run_cli(self.root, "resolve", "gcal", "--op", "write", "--current", "antigravity/gemini-4-neon"))
        self.assertEqual(cal["rules"], ["20261123-124416-d7ca"])

    def test_fallback_rules_and_provider_only_matching(self) -> None:
        # Valid fallback from non-matching provider -> delegate to sonnet
        fb = j(run_cli(
            self.root, "resolve", "gmail", "--op", "write",
            "--current", "antigravity/gemini-4-neon", "--fallback", "--reason", "auth_error",
        ))
        self.assertEqual(fb["action"], "delegate")
        self.assertEqual(fb["target"]["providerInstanceId"], "claudeAgent")
        self.assertEqual(fb["match_mode"], "provider_only")
        self.assertIn("drift_report", fb)

        # Fallback matches on provider alone (claudeAgent/claude-opus-5-5 matches sonnet's claudeAgent)
        fb_nat = j(run_cli(
            self.root, "resolve", "gmail", "--op", "read",
            "--current", "claudeAgent/claude-opus-5-5", "--fallback", "--reason", "unavailable",
        ))
        self.assertEqual(fb_nat["action"], "native")
        self.assertEqual(fb_nat["resolution"], "current_provider_matches_fallback")

        # Fallback is forbidden on empty_result -> block
        blocked = j(run_cli(
            self.root, "resolve", "gmail", "--op", "read",
            "--current", "antigravity/gemini-4-neon", "--fallback", "--reason", "empty_result",
        ))
        self.assertEqual(blocked["action"], "block")
        self.assertEqual(blocked["resolution"], "fallback_forbidden_on_empty_result")

        # Native fallback (integrated_browser)
        br_fb = j(run_cli(
            self.root, "resolve", "integrated_browser", "--op", "read",
            "--current", "antigravity/gemini-4-neon", "--fallback", "--reason", "tool_absent",
        ))
        self.assertEqual(br_fb["action"], "native")

    def test_directions_and_unlisted_and_missing_config(self) -> None:
        ro = j(run_cli(self.root, "resolve", "read_only_feed", "--op", "write"))
        self.assertEqual(ro["action"], "block")
        self.assertEqual(ro["resolution"], "direction_not_allowed")

        nwf = j(run_cli(self.root, "resolve", "no_write_fallback", "--op", "write", "--fallback", "--reason", "auth_error"))
        self.assertEqual(nwf["action"], "block")
        self.assertEqual(nwf["resolution"], "fallback_direction_not_allowed")

        unlisted = j(run_cli(self.root, "resolve", "slack", "--op", "write"))
        self.assertEqual(unlisted["action"], "native_or_block")
        self.assertFalse(unlisted["route_found"])
        self.assertIn("explicit_approval_or_rule", unlisted["gates"])

        # Missing harnesses.toml
        (self.root / "harnesses.toml").unlink()
        missing = j(run_cli(self.root, "resolve", "gmail", "--op", "read"))
        self.assertFalse(missing["config_present"])
        self.assertEqual(missing["action"], "native_or_block")

    def test_validation_rejects_bad_config(self) -> None:
        for bad_toml, needle in (
            ('providers = ["codex"]\n[aliases]\nx = { provider = "nope" }\n', "not in top-level providers"),
            ('[routes.gmail]\nprimary = "missing_alias"\n', "unknown alias"),
            ('[routes.gmail]\nprimary = "native"\nbogus_key = 1\n', "unknown key"),
            ('[routes.a]\nprimary = "native"\naliases = ["dup"]\n[routes.b]\nprimary = "native"\naliases = ["dup"]\n', "collides"),
        ):
            (self.root / "harnesses.toml").write_text(bad_toml, encoding="utf-8")
            proc = run_cli(self.root, "validate", check=False)
            self.assertNotEqual(proc.returncode, 0, bad_toml)
            self.assertIn(needle, proc.stderr)

    def test_telemetry_and_stats(self) -> None:
        run_cli(self.root, "resolve", "gmail", "--op", "write", "--current", "antigravity/gemini-4-neon")
        run_cli(self.root, "resolve", "gmail", "--op", "write", "--current", "antigravity/gemini-4-neon", "--fallback", "--reason", "auth_error")
        run_cli(self.root, "resolve", "gmail", "--op", "read", "--current", "antigravity/gemini-4-neon", "--fallback", "--reason", "empty_result")
        run_cli(self.root, "resolve", "gmail", "--op", "read", "--no-log")

        stats = j(run_cli(self.root, "stats"))
        self.assertEqual(stats["total"], 3)
        self.assertEqual(stats["fallbacks"], 2)
        self.assertEqual(stats["blocks"], 1)
        self.assertEqual(stats["fallback_reasons"], {"auth_error": 1, "empty_result": 1})

    def test_refuses_engine_directory(self) -> None:
        proc = subprocess.run(
            ["uv", "run", "-q", "--directory", str(ENGINE_DIR), "harness-route", "list"],
            text=True, capture_output=True, check=False,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("Refusing to use the Thoth engine directory", proc.stderr)


if __name__ == "__main__":
    unittest.main()
