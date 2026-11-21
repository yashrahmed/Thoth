"""Tests for the todo-list CLI: CRUD, IDs, dedupe, filters, revisions, log, archive, secrets, locking."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]


def run_cli(root: Path, *args: str, stdin_data: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    env = {**os.environ, "THOTH_TZ": "America/Chicago"}
    proc = subprocess.run(
        ["uv", "run", "-q", "--directory", str(ENGINE_DIR), "todo-list", "--root", str(root), *args],
        input=stdin_data,
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


class TestTodoListCLI(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def create(self, payload: dict, check: bool = True) -> subprocess.CompletedProcess:
        return run_cli(self.root, "create", "--json", stdin_data=json.dumps(payload), check=check)

    def test_crud_lifecycle_with_log_and_revision(self) -> None:
        res = j(self.create({
            "title": "Pay $40 invoice",
            "due": "2026-11-25",
            "notes": "Budget is $40.",
            "reason": "from Gmail",
        }))
        self.assertEqual(res["action"], "created")
        self.assertEqual(res["id"], "t-0001")
        self.assertEqual(res["revision"], 1)
        self.assertIn("$40", res["title"])

        upd = j(run_cli(self.root, "update", "t-1", "--json", stdin_data=json.dumps({
            "status": "waiting", "scheduled": "2026-11-23", "reason": "asked vendor", "expected_revision": 1,
        })))
        self.assertEqual(upd["status"], "waiting")
        self.assertEqual(upd["revision"], 2)

        done = j(run_cli(self.root, "done", "1", "--reason", "paid"))
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["revision"], 3)

        task = j(run_cli(self.root, "read", "t-0001"))["task"]
        self.assertEqual(task["notes"], "Budget is $40.")
        self.assertEqual(len(task["log"]), 3)
        self.assertTrue(task["log"][0].endswith("| created (open) | from Gmail"))
        self.assertTrue(task["log"][1].endswith("| open -> waiting | asked vendor"))
        self.assertTrue(task["log"][2].endswith("| waiting -> done | paid"))

        raw = run_cli(self.root, "read", "1", "--md").stdout
        self.assertTrue(raw.startswith("---\n"))
        self.assertIn("\n## Log\n", raw)

    def test_sequential_ids_survive_archive(self) -> None:
        self.create({"title": "a"})
        self.create({"title": "b"})
        run_cli(self.root, "delete", "t-2")
        self.assertEqual(j(self.create({"title": "c"}))["id"], "t-0003")

    def test_strict_json_keys_and_validation(self) -> None:
        bad = self.create({"title": "x", "bogus": 1}, check=False)
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("Unknown JSON key", bad.stderr)
        for payload in (
            {"title": ""},
            {"title": "two\nlines"},
            {"title": "x", "status": "maybe"},
            {"title": "x", "priority": "urgent"},
            {"title": "x", "due": "2026-02-30"},
            {"title": "x", "due": "next week"},
            {"title": "x", "source_keys": ["no colon"]},
            {"title": "x", "notes": "a\n## Log\nb"},
            {"title": "x", "source_keys": ["gmail:a,b"]},
            {"title": "x", "memory_ids": ["sk-proj-abcdefghijklmnopqrstuvwxyz123456"]},
        ):
            self.assertNotEqual(self.create(payload, check=False).returncode, 0, payload)

    def test_source_key_dedupe_returns_existing_and_detects_conflict(self) -> None:
        first = j(self.create({"title": "Reply to dentist", "source_keys": ["gmail:m1"]}))
        again = j(self.create({"title": "Different title", "source_keys": ["gmail:m1", "gmail:m2"]}))
        self.assertEqual(again["action"], "existing")
        self.assertEqual(again["id"], first["id"])
        self.assertEqual(again["unmatched_keys"], ["gmail:m2"])

        self.create({"title": "Other", "source_keys": ["gcal:e1"]})
        clash = self.create({"title": "Both", "source_keys": ["gmail:m1", "gcal:e1"]}, check=False)
        self.assertNotEqual(clash.returncode, 0)
        self.assertIn("more than one task", clash.stderr)

        # A key cannot be attached to a second task.
        steal = run_cli(self.root, "update", "t-2", "--add-source-key", "gmail:m1", check=False)
        self.assertNotEqual(steal.returncode, 0)

        # Archived and dropped tasks keep their keys reserved.
        run_cli(self.root, "update", "1", "--status", "dropped")
        run_cli(self.root, "delete", "1")
        again = j(self.create({"title": "Reply to dentist", "source_keys": ["gmail:m1"]}))
        self.assertEqual(again["action"], "existing")
        self.assertTrue(again["archived"])

    def test_list_defaults_sort_and_filters(self) -> None:
        today = datetime.now(ZoneInfo("America/Chicago")).date()
        later = (today + timedelta(days=7)).isoformat()
        past = (today - timedelta(days=1)).isoformat()
        self.create({"title": "no due low", "priority": "low"})
        self.create({"title": "due later", "due": later})
        self.create({"title": "due soon high", "due": past, "priority": "high"})
        self.create({"title": "scheduled later", "scheduled": later})
        self.create({"title": "waiting ready", "status": "waiting", "scheduled": past})
        self.create({"title": "waiting not ready", "status": "waiting"})
        self.create({"title": "finished", "status": "done", "source_keys": ["chat:thread-9"]})

        titles = [t["title"] for t in j(run_cli(self.root, "list"))["tasks"]]
        self.assertNotIn("finished", titles)
        self.assertEqual(titles[0], "due soon high")
        self.assertEqual(titles[1], "due later")

        actionable = {t["title"] for t in j(run_cli(self.root, "list", "--actionable"))["tasks"]}
        self.assertEqual(actionable, {"no due low", "due later", "due soon high", "waiting ready"})

        due_by = {t["title"] for t in j(run_cli(self.root, "list", "--due-by", today.isoformat()))["tasks"]}
        self.assertEqual(due_by, {"due soon high"})

        self.assertEqual(j(run_cli(self.root, "list", "--status", "all"))["count"], 7)
        self.assertEqual(j(run_cli(self.root, "list", "--priority", "low"))["count"], 1)

        by_source = j(run_cli(self.root, "list", "--source", "chat:thread-9", "--source", "gmail:none"))
        self.assertEqual(by_source["matched_keys"], {"chat:thread-9": "t-0007"})
        self.assertEqual(by_source["unmatched_keys"], ["gmail:none"])

        # Comma-separated --source values are split, and --limit doesn't hide matches.
        self.create({"title": "second source", "source_keys": ["gmail:m2"]})
        combo = j(run_cli(self.root, "list", "--source", "chat:thread-9,gmail:m2", "--limit", "1"))
        self.assertEqual(combo["count"], 1)
        self.assertEqual(set(combo["matched_keys"]), {"chat:thread-9", "gmail:m2"})
        self.assertEqual(combo["unmatched_keys"], [])

        # Archived tasks are never actionable, even when --source pulls them in.
        run_cli(self.root, "delete", "t-8")
        self.assertEqual(j(run_cli(self.root, "list", "--actionable", "--source", "gmail:m2"))["count"], 0)

    def test_search(self) -> None:
        self.create({"title": "Return shelf", "notes": "Amazon refund for https://example.com/order/1"})
        self.create({"title": "Call uncle"})
        hits = j(run_cli(self.root, "search", "refund"))["hits"]
        self.assertEqual([h["id"] for h in hits], ["t-0001"])
        url_hits = j(run_cli(self.root, "search", "https://example.com/order/1"))["hits"]
        self.assertEqual(len(url_hits), 1)
        self.assertEqual(j(run_cli(self.root, "search", "nothing-here"))["count"], 0)

    def test_update_fields_clear_dates_and_stale_revision(self) -> None:
        self.create({"title": "x", "due": "2026-12-01", "memory_ids": ["20261120-090700-aa7c"]})
        upd = j(run_cli(self.root, "update", "1", "--json", stdin_data=json.dumps({
            "title": "y", "priority": "high", "due": "", "add_memory_ids": ["20261121-131717-f17c"],
            "append": "more context",
        })))
        self.assertEqual(upd["title"], "y")
        self.assertNotIn("due", upd)
        task = j(run_cli(self.root, "read", "1"))["task"]
        self.assertEqual(task["memory_ids"], ["20261120-090700-aa7c", "20261121-131717-f17c"])
        self.assertIn("more context", task["notes"])

        stale = run_cli(self.root, "update", "1", "--title", "z", "--expected-revision", "1", check=False)
        self.assertNotEqual(stale.returncode, 0)
        self.assertIn("Conflict", stale.stderr)

        for bad_rev in (True, 2.9, "2"):
            proc = run_cli(self.root, "update", "1", "--json", stdin_data=json.dumps({"title": "z", "expected_revision": bad_rev}), check=False)
            self.assertNotEqual(proc.returncode, 0, bad_rev)

        nothing = run_cli(self.root, "update", "1", check=False)
        self.assertNotEqual(nothing.returncode, 0)

        same = j(run_cli(self.root, "update", "1", "--title", "y"))
        self.assertEqual(same["action"], "unchanged")
        self.assertEqual(same["revision"], 2)

    def test_delete_restore_and_hard_delete(self) -> None:
        self.create({"title": "x"})
        arch = j(run_cli(self.root, "delete", "1", "--reason", "duplicate"))
        self.assertEqual(arch["action"], "archived")
        self.assertEqual(arch["revision"], 2)
        self.assertTrue(arch["archived"])
        self.assertTrue((self.root / "tasks" / ".archive" / "t-0001.md").exists())
        self.assertEqual(j(run_cli(self.root, "list", "--status", "all"))["count"], 0)
        self.assertTrue(j(run_cli(self.root, "read", "1"))["task"]["archived"])
        self.assertNotEqual(run_cli(self.root, "update", "1", "--title", "y", check=False).returncode, 0)

        j(run_cli(self.root, "restore", "1"))
        log = j(run_cli(self.root, "read", "1"))["task"]["log"]
        self.assertTrue(log[-2].endswith("| archived | duplicate"))
        self.assertTrue(log[-1].endswith("| restored"))

        hard = j(run_cli(self.root, "delete", "1", "--hard"))
        self.assertEqual(hard["action"], "hard_deleted")
        self.assertNotEqual(run_cli(self.root, "read", "1", check=False).returncode, 0)

    def test_rejects_secrets(self) -> None:
        for payload in (
            {"title": "key sk-proj-abcdefghijklmnopqrstuvwxyz123456"},
            {"title": "x", "notes": "AKIAABCDEFGHIJKLMNOP"},
            {"title": "x", "reason": "ghp_abcdefghijklmnopqrstuvwxyz0123"},
        ):
            proc = self.create(payload, check=False)
            self.assertNotEqual(proc.returncode, 0, payload)
            self.assertIn("redact", proc.stderr)

    def test_unreadable_file_blocks_writes_but_not_reads(self) -> None:
        self.create({"title": "ok"})
        (self.root / "tasks" / "t-0002.md").write_text("not a task\n", encoding="utf-8")
        listed = j(run_cli(self.root, "list"))
        self.assertEqual(listed["count"], 1)
        self.assertIn("warnings", listed)
        blocked = self.create({"title": "new"}, check=False)
        self.assertNotEqual(blocked.returncode, 0)
        self.assertIn("unreadable", blocked.stderr)

    def test_concurrent_creates_get_unique_ids(self) -> None:
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda i: j(self.create({"title": f"task {i}"})), range(6)))
        ids = sorted(r["id"] for r in results)
        self.assertEqual(ids, [f"t-{n:04d}" for n in range(1, 7)])

    def test_refuses_engine_directory(self) -> None:
        proc = subprocess.run(
            ["uv", "run", "-q", "--directory", str(ENGINE_DIR), "todo-list", "list"],
            text=True, capture_output=True, check=False,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("Refusing to use the Thoth engine directory", proc.stderr)


if __name__ == "__main__":
    unittest.main()
