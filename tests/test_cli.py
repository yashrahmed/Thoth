"""Tests for thoth-mem CLI: CRUD, strict JSON keys, multi-tag AND, URL search, ranges, secrets, flock."""

from __future__ import annotations

import json
import os
import subprocess
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
            "topic": "gear/desk-mat",
            "title": "Pick desk mat under $75",
            "tags": ["gear", "open"],
            "sources": ["https://example.com/desk-mat"],
            "when": "2026-11-15 14:30:00",
            "body": "Budget is $75 max.",
        }
        res = json.loads(run_cli(self.root, "create", "--json", stdin_data=json.dumps(payload)).stdout)
        self.assertTrue(res["ok"])
        ep_id = res["id"]
        self.assertRegex(ep_id, r"^\d{8}-\d{6}-[0-9a-f]{4}$")
        self.assertIn("$75", res["title"])

        rec = json.loads(run_cli(self.root, "read", ep_id).stdout)
        self.assertNotIn("updated", rec["meta"])
        orig_when = rec["meta"]["when"]

        upd = json.loads(
            run_cli(
                self.root,
                "update",
                ep_id,
                "--json",
                stdin_data=json.dumps({"append": "Ordered for $59.", "remove_tags": ["open"], "add_tags": ["done"]}),
            ).stdout
        )
        self.assertEqual(upd["when"], orig_when)
        self.assertTrue(upd["updated"])
        self.assertEqual(upd["tags"], ["gear", "done"])

        bad = run_cli(self.root, "update", ep_id, "--append", "nope", "--expected-updated", "wrong-ts", check=False)
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("Conflict", bad.stderr)

        self.assertEqual(json.loads(run_cli(self.root, "delete", ep_id).stdout)["action"], "archived")
        self.assertEqual(json.loads(run_cli(self.root, "list").stdout)["count"], 0)
        self.assertEqual(json.loads(run_cli(self.root, "restore", ep_id).stdout)["action"], "restored")
        self.assertEqual(json.loads(run_cli(self.root, "list").stdout)["count"], 1)

    def test_unknown_json_keys_and_ambiguous_duration_rejected(self) -> None:
        bad_create = run_cli(
            self.root,
            "create",
            "--json",
            stdin_data=json.dumps({"kind": "note", "topic": "test", "title": "T", "body": "B", "tag": ["x"]}),
            check=False,
        )
        self.assertNotEqual(bad_create.returncode, 0)
        self.assertIn("Unknown JSON key", bad_create.stderr)

        ep = json.loads(
            run_cli(
                self.root,
                "create",
                "--json",
                stdin_data=json.dumps({"kind": "note", "topic": "test", "title": "T", "body": "B"}),
            ).stdout
        )
        bad_upd = run_cli(
            self.root,
            "update",
            ep["id"],
            "--json",
            stdin_data=json.dumps({"add_tag": ["done"]}),
            check=False,
        )
        self.assertNotEqual(bad_upd.returncode, 0)
        self.assertIn("Unknown JSON key", bad_upd.stderr)

        bad_dur = run_cli(self.root, "list", "--since", "30m", check=False)
        self.assertNotEqual(bad_dur.returncode, 0)
        self.assertIn("mo", bad_dur.stderr)

    def test_date_ranges_multi_tag_topics_and_source_search(self) -> None:
        rows = [
            {"when": "2026-10-28 09:00:00", "kind": "commitment", "topic": "orders/widget", "title": "Open order", "tags": ["commitment", "open"], "sources": ["https://shop.example.com/order/991"], "body": "Follow up at 12:30"},
            {"when": "2026-11-10 10:00:00", "kind": "commitment", "topic": "orders/widget", "title": "Closed order", "tags": ["commitment", "done"], "sources": ["https://other.example.com/item/1"], "body": "Delivered"},
            {"when": "2026-11-18 18:00:00", "kind": "event", "topic": "planning/thoth", "title": "Thoth design", "tags": ["planning"], "body": "Chose CLI"},
        ]
        for r in rows:
            run_cli(self.root, "create", "--json", stdin_data=json.dumps(r))

        r1 = json.loads(run_cli(self.root, "list", "--since", "2026-10-25", "--until", "2026-11-12").stdout)
        self.assertEqual(r1["count"], 2)

        open_c = json.loads(run_cli(self.root, "list", "--tag", "commitment", "--tag", "open").stdout)
        self.assertEqual(open_c["count"], 1)
        self.assertEqual(open_c["episodes"][0]["title"], "Open order")

        url_hit = json.loads(run_cli(self.root, "search", "https://shop.example.com/order/991").stdout)
        self.assertEqual(url_hit["count"], 1)
        self.assertEqual(url_hit["hits"][0]["title"], "Open order")

        t_hit = json.loads(run_cli(self.root, "search", "12:30").stdout)
        self.assertEqual(t_hit["count"], 1)

        tp = json.loads(run_cli(self.root, "topics").stdout)
        self.assertEqual(tp["count"], 2)

    def test_secret_rejection_and_parallel_flock(self) -> None:
        bad = run_cli(
            self.root,
            "create",
            "--json",
            stdin_data=json.dumps({"kind": "note", "topic": "sec", "title": "Key", "body": "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234"}),
            check=False,
        )
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("API key", bad.stderr)

        def worker(i: int) -> dict:
            out = run_cli(
                self.root,
                "create",
                "--json",
                stdin_data=json.dumps({"kind": "event", "topic": "concurrency/test", "title": f"Write {i}", "body": f"Payload {i}"}),
            ).stdout
            return json.loads(out)

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(worker, range(12)))
        self.assertEqual(len({r["id"] for r in results}), 12)
        self.assertEqual(json.loads(run_cli(self.root, "list").stdout)["count"], 12)


if __name__ == "__main__":
    unittest.main()
