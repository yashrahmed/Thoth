"""Tests for thoth-mem CLI: CRUD, date ranges, JSON stdin, secrets, update timestamps, and parallel locking."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

THOTH_ROOT = Path(__file__).resolve().parents[1]


def run_cli(root: Path, *args: str, stdin_data: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    env = {**os.environ, "THOTH_TZ": "America/Chicago"}
    proc = subprocess.run(
        ["uv", "run", "--directory", str(THOTH_ROOT), "thoth-mem", "--root", str(root), *args],
        input=stdin_data,
        text=True,
        capture_output=True,
        env=env,
        check=False,
    )
    if check and proc.returncode != 0:
        raise AssertionError(f"CLI failed ({proc.returncode}): {args}\nstdout={proc.stdout}\nstderr={proc.stderr}")
    return proc


class TestThothMemCLI(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_create_json_preserves_dollar_and_crud_lifecycle(self) -> None:
        payload = {
            "kind": "decision",
            "topic": "home/office-chair",
            "title": "Test flat-back chairs under $300",
            "tags": ["home", "open"],
            "sources": ["https://example.com/chair"],
            "when": "2026-11-15 14:30:00",
            "body": "Ruled out gaming bolsters; budget is $300 max.",
        }
        res = json.loads(run_cli(self.root, "create", "--json", stdin_data=json.dumps(payload)).stdout)
        self.assertTrue(res["ok"])
        ep_id = res["id"]
        self.assertRegex(ep_id, r"^\d{8}-\d{6}-[0-9a-f]{4}$")
        self.assertIn("$300", res["title"])
        self.assertIn("$300", res["body_preview"])

        # Read back
        rec = json.loads(run_cli(self.root, "read", ep_id).stdout)
        self.assertEqual(rec["meta"]["title"], "Test flat-back chairs under $300")
        self.assertNotIn("updated", rec["meta"])
        orig_when = rec["meta"]["when"]

        # Update via JSON stdin: preserves 'when', stamps 'updated', swaps open -> done
        upd_payload = {
            "append": "Bought flat-back chair for $249.",
            "remove_tags": ["open"],
            "add_tags": ["done"],
        }
        upd = json.loads(run_cli(self.root, "update", ep_id, "--json", stdin_data=json.dumps(upd_payload)).stdout)
        self.assertTrue(upd["ok"])
        self.assertEqual(upd["when"], orig_when)
        self.assertTrue(upd["updated"])
        self.assertEqual(upd["tags"], ["home", "done"])

        # Optimistic concurrency conflict check
        bad = run_cli(
            self.root, "update", ep_id, "--append", "nope", "--expected-updated", "wrong-ts", check=False
        )
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("Conflict", bad.stderr)

        # Soft delete & restore
        d = json.loads(run_cli(self.root, "delete", ep_id).stdout)
        self.assertEqual(d["action"], "archived")
        self.assertEqual(json.loads(run_cli(self.root, "list").stdout)["count"], 0)

        restored = json.loads(run_cli(self.root, "restore", ep_id).stdout)
        self.assertEqual(restored["action"], "restored")
        self.assertEqual(json.loads(run_cli(self.root, "list").stdout)["count"], 1)

    def test_date_ranges_relative_windows_and_topics(self) -> None:
        samples = [
            ("2026-10-28 09:00:00", "orders/widget", "Old October order", "Ordered widget A"),
            ("2026-11-10 10:00:00", "orders/widget", "November update", "Refund pending for widget A"),
            ("2026-11-18 18:00:00", "planning/thoth", "Thoth v2 design", "Chose CLI with flock"),
        ]
        for when, topic, title, body in samples:
            run_cli(
                self.root,
                "create",
                "--json",
                stdin_data=json.dumps({"kind": "event", "when": when, "topic": topic, "title": title, "body": body}),
            )

        # Cross-month range
        r1 = json.loads(run_cli(self.root, "list", "--since", "2026-10-25", "--until", "2026-11-12").stdout)
        self.assertEqual(r1["count"], 2)
        self.assertEqual([e["title"] for e in r1["episodes"]], ["Old October order", "November update"])

        # Search + date range combined
        s1 = json.loads(run_cli(self.root, "search", "widget", "--since", "2026-11-01").stdout)
        self.assertEqual(s1["count"], 1)
        self.assertEqual(s1["hits"][0]["title"], "November update")

        # Topics summary
        tp = json.loads(run_cli(self.root, "topics").stdout)
        self.assertEqual(tp["count"], 2)
        self.assertEqual(tp["topics"][0]["topic"], "planning/thoth")
        self.assertEqual(tp["topics"][1]["count"], 2)

    def test_secret_rejection(self) -> None:
        bad = run_cli(
            self.root,
            "create",
            "--json",
            stdin_data=json.dumps({
                "kind": "note",
                "topic": "security",
                "title": "Oops key",
                "body": "My token is sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234",
            }),
            check=False,
        )
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("API key", bad.stderr)

    def test_parallel_flock_writes(self) -> None:
        def worker(i: int) -> dict:
            out = run_cli(
                self.root,
                "create",
                "--json",
                stdin_data=json.dumps({
                    "kind": "event",
                    "topic": "concurrency/test",
                    "title": f"Parallel write {i}",
                    "body": f"Worker {i} payload",
                }),
            ).stdout
            return json.loads(out)

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(worker, range(12)))
        self.assertEqual(len({r["id"] for r in results}), 12)
        listed = json.loads(run_cli(self.root, "list").stdout)
        self.assertEqual(listed["count"], 12)


if __name__ == "__main__":
    unittest.main()
