"""Tests for the auto-commit CLI: path allowlist, surgical staging, git guards, ignore, telemetry."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]


def run_cli(root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    env = {**os.environ, "THOTH_TZ": "America/Chicago"}
    proc = subprocess.run(
        ["uv", "run", "-q", "--directory", str(ENGINE_DIR), "auto-commit", "--root", str(root), *args],
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    if check and proc.returncode != 0:
        raise AssertionError(f"CLI failed ({proc.returncode}): {args}\nstdout={proc.stdout}\nstderr={proc.stderr}")
    return proc


def git(root: Path, *args: str) -> subprocess.CompletedProcess:
    proc = subprocess.run(["git", *args], cwd=str(root), text=True, capture_output=True, check=False)
    if proc.returncode != 0:
        raise AssertionError(f"git failed: {args}\n{proc.stderr}")
    return proc


def j(proc: subprocess.CompletedProcess) -> dict:
    return json.loads(proc.stdout)


class TestAutoCommitCLI(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        git(self.root, "init", "-q")
        git(self.root, "config", "user.name", "Test User")
        git(self.root, "config", "user.email", "test@example.com")
        (self.root / ".gitignore").write_text("work-artifacts/**/screenshots/\n.thoth-telemetry/\n", encoding="utf-8")
        (self.root / "README.md").write_text("init\n", encoding="utf-8")
        git(self.root, "add", ".gitignore", "README.md")
        git(self.root, "commit", "-q", "-m", "initial")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_commits_only_specified_state_paths_leaving_unrelated_staged_and_dirty(self) -> None:
        # Unrelated staged file + unrelated dirty file
        (self.root / "staged_code.py").write_text("print('keep staged')\n", encoding="utf-8")
        git(self.root, "add", "staged_code.py")
        (self.root / "README.md").write_text("dirty readme\n", encoding="utf-8")

        # Allowed state files: new + archive move
        (self.root / "tasks").mkdir()
        (self.root / "tasks" / "t-0001.md").write_text("task 1\n", encoding="utf-8")
        (self.root / "health").mkdir()
        (self.root / "health" / "2026-11.jsonl").write_text("{}\n", encoding="utf-8")

        res = j(run_cli(self.root, "run", "-m", "Log task and health entry", "tasks/t-0001.md", "health/2026-11.jsonl"))
        self.assertEqual(res["action"], "committed")
        self.assertTrue(res["commit"])

        # Verify ONLY the two state files are in the commit
        committed = git(self.root, "show", "--name-only", "--format=", "HEAD").stdout.strip().splitlines()
        self.assertEqual(sorted(committed), ["health/2026-11.jsonl", "tasks/t-0001.md"])

        # Unrelated staged_code.py must STILL be staged, and README.md still dirty!
        porcelain = git(self.root, "status", "--porcelain").stdout
        self.assertIn("A  staged_code.py", porcelain)
        self.assertIn(" M README.md", porcelain)

        # Move/archive (old + new path)
        (self.root / "tasks" / ".archive").mkdir()
        (self.root / "tasks" / "t-0001.md").rename(self.root / "tasks" / ".archive" / "t-0001.md")
        mv = j(run_cli(self.root, "run", "-m", "Archive t-0001", "tasks/t-0001.md", "tasks/.archive/t-0001.md"))
        self.assertEqual(mv["action"], "committed")
        committed2 = git(self.root, "show", "--name-only", "--format=", "HEAD").stdout.strip().splitlines()
        self.assertIn("tasks/.archive/t-0001.md", committed2)
        self.assertIn("A  staged_code.py", git(self.root, "status", "--porcelain").stdout)

    def test_enforces_allowed_prefixes_and_blocks_escape(self) -> None:
        (self.root / "AGENTS.md").write_text("rules\n", encoding="utf-8")
        proc = run_cli(self.root, "run", "-m", "bad", "AGENTS.md", check=False)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("outside allowed auto-commit state prefixes", proc.stderr)

        esc = run_cli(self.root, "run", "-m", "bad", "../outside.txt", check=False)
        self.assertNotEqual(esc.returncode, 0)

        dot = run_cli(self.root, "run", "-m", "bad", ".", check=False)
        self.assertNotEqual(dot.returncode, 0)

    def test_custom_thoth_toml_prefixes_and_validate(self) -> None:
        (self.root / "thoth.toml").write_text('[auto_commit]\npaths = ["notes/"]\n', encoding="utf-8")
        val = j(run_cli(self.root, "validate"))
        self.assertEqual(val["allowed_prefixes"], ["notes/"])
        self.assertTrue(val["git_ready"])

        (self.root / "notes").mkdir()
        (self.root / "notes" / "a.md").write_text("hi\n", encoding="utf-8")
        res = j(run_cli(self.root, "run", "-m", "Add note", "notes/a.md"))
        self.assertEqual(res["action"], "committed")

        # Default prefix `tasks/` is no longer allowed when overridden
        (self.root / "tasks").mkdir()
        (self.root / "tasks" / "t.md").write_text("x\n", encoding="utf-8")
        self.assertNotEqual(run_cli(self.root, "run", "-m", "no", "tasks/t.md", check=False).returncode, 0)

    def test_skips_ignored_nothing_to_commit_merge_and_non_git(self) -> None:
        # Gitignored path skipped cleanly
        shots = self.root / "work-artifacts" / "demo" / "screenshots"
        shots.mkdir(parents=True)
        (shots / "f1.png").write_bytes(b"png")
        ign = j(run_cli(self.root, "run", "-m", "shots", "work-artifacts/demo/screenshots/f1.png"))
        self.assertEqual(ign["action"], "skipped")
        self.assertEqual(ign["reason"], "all_ignored")

        # Unchanged tracked path -> nothing_to_commit
        (self.root / "tasks").mkdir()
        (self.root / "tasks" / "t-1.md").write_text("a\n", encoding="utf-8")
        run_cli(self.root, "run", "-m", "add", "tasks/t-1.md")
        noop = j(run_cli(self.root, "run", "-m", "again", "tasks/t-1.md"))
        self.assertEqual(noop["action"], "skipped")
        self.assertEqual(noop["reason"], "nothing_to_commit")

        # Merge in progress -> skipped
        (self.root / ".git" / "MERGE_HEAD").write_text("deadbeef\n", encoding="utf-8")
        (self.root / "tasks" / "t-1.md").write_text("b\n", encoding="utf-8")
        merged = j(run_cli(self.root, "run", "-m", "during merge", "tasks/t-1.md"))
        self.assertEqual(merged["action"], "skipped")
        self.assertEqual(merged["reason"], "git_op_in_progress:MERGE_HEAD")
        (self.root / ".git" / "MERGE_HEAD").unlink()

        # Non-git directory -> skipped cleanly
        with tempfile.TemporaryDirectory() as nongit:
            ng = Path(nongit)
            (ng / "tasks").mkdir()
            (ng / "tasks" / "t.md").write_text("x\n", encoding="utf-8")
            sk = j(run_cli(ng, "run", "-m", "x", "tasks/t.md"))
            self.assertEqual(sk["action"], "skipped")
            self.assertEqual(sk["reason"], "not_git_repo")

    def test_dry_run_secrets_stats_and_engine_refusal(self) -> None:
        (self.root / "tasks").mkdir()
        (self.root / "tasks" / "t-1.md").write_text("a\n", encoding="utf-8")

        dry = j(run_cli(self.root, "run", "--dry-run", "-m", "dry", "tasks/t-1.md"))
        self.assertEqual(dry["action"], "dry_run")
        self.assertIn("?? tasks/", git(self.root, "status", "--porcelain").stdout)

        bad_secret = run_cli(self.root, "run", "-m", "key sk-proj-abcdefghijklmnopqrstuvwxyz123456", "tasks/t-1.md", check=False)
        self.assertNotEqual(bad_secret.returncode, 0)
        self.assertIn("redact", bad_secret.stderr)

        run_cli(self.root, "run", "-m", "commit 1", "tasks/t-1.md")
        run_cli(self.root, "run", "-m", "noop", "tasks/t-1.md")
        stats = j(run_cli(self.root, "stats"))
        self.assertEqual(stats["total"], 2)
        self.assertEqual(stats["by_action"], {"committed": 1, "skipped": 1})
        self.assertEqual(stats["skip_reasons"], {"nothing_to_commit": 1})

        eng = subprocess.run(
            ["uv", "run", "-q", "--directory", str(ENGINE_DIR), "auto-commit", "validate"],
            text=True, capture_output=True, check=False,
        )
        self.assertNotEqual(eng.returncode, 0)
        self.assertIn("Refusing to use the Thoth engine directory", eng.stderr)


if __name__ == "__main__":
    unittest.main()
