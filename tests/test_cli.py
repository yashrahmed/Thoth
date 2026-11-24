"""Tests for thoth-mem CLI: CRUD, strict JSON keys, multi-tag AND, URL search, ranges, secrets, flock."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]


def run_cli(root: Path, *args: str, stdin_data: str | None = None, check: bool = True) -> subprocess.CompletedProcess:
    env = {**os.environ, "THOTH_TZ": "America/Chicago"}
    proc = subprocess.run(
        ["uv", "run", "--directory", str(ENGINE_DIR), "thoth-mem", "--root", str(root), *args],
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

        bad_root = run_cli(ENGINE_DIR, "topics", check=False)
        self.assertNotEqual(bad_root.returncode, 0)
        self.assertIn("Thoth engine directory", bad_root.stderr)

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

    def test_pagination_for_list_search_and_topics(self) -> None:
        for i in range(18):
            topic = f"paging/topic-{i % 3}"
            payload = {
                "when": f"2026-11-{i + 1:02d} 10:00:00",
                "kind": "note",
                "topic": topic,
                "title": f"Chair entry {i:02d}",
                "body": f"Chair research item {i:02d}",
            }
            run_cli(self.root, "create", "--json", stdin_data=json.dumps(payload))

        # search defaults to --limit 15 and reports total + next_offset
        s1 = json.loads(run_cli(self.root, "search", "chair").stdout)
        self.assertEqual(s1["count"], 15)
        self.assertEqual(s1["total"], 18)
        self.assertEqual(s1["offset"], 0)
        self.assertEqual(s1["limit"], 15)
        self.assertTrue(s1["has_more"])
        self.assertEqual(s1["next_offset"], 15)

        s2 = json.loads(run_cli(self.root, "search", "chair", "--offset", str(s1["next_offset"])).stdout)
        self.assertEqual(s2["count"], 3)
        self.assertEqual(s2["total"], 18)
        self.assertEqual(s2["offset"], 15)
        self.assertFalse(s2["has_more"])
        self.assertNotIn("next_offset", s2)
        self.assertEqual(len({h["id"] for h in s1["hits"] + s2["hits"]}), 18)

        # --limit 0 returns all hits in one shot
        s_all = json.loads(run_cli(self.root, "search", "chair", "--limit", "0").stdout)
        self.assertEqual(s_all["count"], 18)
        self.assertEqual(s_all["total"], 18)
        self.assertFalse(s_all["has_more"])
        self.assertNotIn("limit", s_all)

        # list exact-multiple page boundary (6 items in topic-0, limit 3)
        l1 = json.loads(run_cli(self.root, "list", "--topic", "paging/topic-0", "--limit", "3").stdout)
        self.assertEqual((l1["count"], l1["total"], l1["has_more"], l1["next_offset"]), (3, 6, True, 3))
        l2 = json.loads(run_cli(self.root, "list", "--topic", "paging/topic-0", "--limit", "3", "--offset", "3").stdout)
        self.assertEqual((l2["count"], l2["total"], l2["has_more"]), (3, 6, False))
        self.assertNotIn("next_offset", l2)

        # offset past end returns empty page with total preserved
        past = json.loads(run_cli(self.root, "list", "--offset", "50").stdout)
        self.assertEqual((past["count"], past["total"], past["offset"], past["has_more"]), (0, 18, 50, False))

        # topics pagination
        t1 = json.loads(run_cli(self.root, "topics", "--limit", "2").stdout)
        self.assertEqual((t1["count"], t1["total"], t1["has_more"], t1["next_offset"]), (2, 3, True, 2))
        t2 = json.loads(run_cli(self.root, "topics", "--limit", "2", "--offset", "2").stdout)
        self.assertEqual((t2["count"], t2["total"], t2["has_more"]), (1, 3, False))

        # negative limit or offset rejected
        for bad_args in (("list", "--limit", "-1"), ("list", "--offset", "-1"), ("search", "chair", "--offset", "-2")):
            proc = run_cli(self.root, *bad_args, check=False)
            self.assertNotEqual(proc.returncode, 0, bad_args)


if __name__ == "__main__":
    unittest.main()
