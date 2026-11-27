"""Tests for the thread-plan CLI: prefixing, model precedence, validation, prompt framing, telemetry."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]

SAMPLE_THOTH_TOML = """\
[threads]
title_prefix = "Personal Bot | "
workspace_default = "local"
default_model = { provider = "claudeAgent", model = "claude-opus-5-5", label = "Claude Opus 5.5" }
"""


def run_cli(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    env = {**os.environ, "THOTH_TZ": "America/Chicago"}
    proc = subprocess.run(
        ["uv", "run", "-q", "--directory", str(ENGINE_DIR), "thread-plan", "--root", str(root), *args],
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


class TestThreadPlanCLI(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        (self.root / "thoth.toml").write_text(SAMPLE_THOTH_TOML, encoding="utf-8")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_validate_and_prefix_idempotency(self) -> None:
        val = j(run_cli(self.root, "validate"))
        self.assertTrue(val["ok"])
        self.assertEqual(val["title_prefix"], "Personal Bot | ")

        p1 = j(run_cli(self.root, "prepare", "--title", "Weekly review", "--task", "Review open tasks"))
        self.assertEqual(p1["action"], "create")
        self.assertEqual(p1["title"], "Personal Bot | Weekly review")
        self.assertEqual(p1["model_source"], "instance_default")
        self.assertEqual(p1["model_selection"]["model"], "claude-opus-5-5")
        self.assertTrue(p1["client_request_id"].startswith("thread-"))
        self.assertTrue(p1["fresh_history"])

        # Already prefixed -> never doubled
        p2 = j(run_cli(self.root, "prepare", "--title", "personal bot | Weekly review", "--task", "Review"))
        self.assertEqual(p2["title"], "Personal Bot | Weekly review")

    def test_missing_inputs_and_title_only(self) -> None:
        ask = j(run_cli(self.root, "prepare"))
        self.assertEqual(ask["action"], "ask")
        self.assertEqual(ask["missing"], ["title_or_task"])

        to = j(run_cli(self.root, "prepare", "--title", "Scratchpad"))
        self.assertEqual(to["prompt_mode"], "title_only")
        self.assertIn("Wait for the user's task", to["starter_prompt"])

        task_only = j(run_cli(self.root, "prepare", "--task", "Debug CI failures"))
        self.assertIsNone(task_only["title"])
        self.assertTrue(task_only["title_needs_derivation"])
        self.assertEqual(task_only["title_prefix"], "Personal Bot | ")

    def test_model_precedence_and_flags(self) -> None:
        # --host-default beats instance default
        hd = j(run_cli(self.root, "prepare", "--title", "T", "--host-default"))
        self.assertEqual(hd["model_source"], "host_default")
        self.assertNotIn("model_selection", hd)

        # Explicit --model + --effort
        req = j(run_cli(self.root, "prepare", "--title", "T", "--model", "astra", "--effort", "high", "--workspace", "worktree", "--fork"))
        self.assertEqual(req["model_source"], "requested")
        self.assertEqual(req["requested_model"], {"model": "astra", "effort": "high"})
        self.assertEqual(req["destination"]["workspace"], "worktree")
        self.assertFalse(req["fresh_history"])

        # Conflicting --host-default + --model rejected
        bad = run_cli(self.root, "prepare", "--title", "T", "--host-default", "--model", "astra", check=False)
        self.assertNotEqual(bad.returncode, 0)

    def test_missing_config_and_bad_config(self) -> None:
        (self.root / "thoth.toml").unlink()
        plain = j(run_cli(self.root, "prepare", "--title", "Plain"))
        self.assertEqual(plain["title"], "Plain")
        self.assertEqual(plain["model_source"], "host_default")

        (self.root / "thoth.toml").write_text('[threads]\nbogus = 1\n', encoding="utf-8")
        proc = run_cli(self.root, "validate", check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("unknown key", proc.stderr)

    def test_telemetry_stats_and_engine_refusal(self) -> None:
        run_cli(self.root, "prepare", "--title", "A", "--task", "do A")
        run_cli(self.root, "prepare", "--title", "B", "--host-default")
        run_cli(self.root, "prepare", "--title", "C", "--no-log")

        stats = j(run_cli(self.root, "stats"))
        self.assertEqual(stats["total"], 2)
        self.assertEqual(stats["by_model_source"], {"instance_default": 1, "host_default": 1})

        eng = subprocess.run(
            ["uv", "run", "-q", "--directory", str(ENGINE_DIR), "thread-plan", "validate"],
            text=True, capture_output=True, check=False,
        )
        self.assertNotEqual(eng.returncode, 0)
        self.assertIn("Refusing to use the Thoth engine directory", eng.stderr)


if __name__ == "__main__":
    unittest.main()
