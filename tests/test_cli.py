"""Tests for thoth-mem CLI: CRUD, {slug: summary} topics map, optional kind allowlist, pagination, ranges, secrets, flock."""

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
            "topics": {
                "gear/desk-mat": "Pick desk mat under $75",
                "finance/home-budget": "Capped desk mat budget at $75",
            },
            "sources": ["https://example.com/desk-mat"],
            "when": "2026-11-15 14:30:00",
            "body": "Budget is $75 max.",
        }
        res = json.loads(run_cli(self.root, "create", "--json", stdin_data=json.dumps(payload)).stdout)
        self.assertTrue(res["ok"])
        ep_id = res["id"]
        self.assertRegex(ep_id, r"^\d{8}-\d{6}-[0-9a-f]{4}$")
        self.assertNotIn("kind", res)
        self.assertEqual(
            res["topics"],
            {"gear/desk-mat": "Pick desk mat under $75", "finance/home-budget": "Capped desk mat budget at $75"},
        )

        rec = json.loads(run_cli(self.root, "read", ep_id).stdout)
        self.assertNotIn("updated", rec["meta"])
        self.assertNotIn("kind", rec["meta"])
        self.assertNotIn("tags", rec["meta"])
        self.assertNotIn("title", rec["meta"])
        orig_when = rec["meta"]["when"]

        upd = json.loads(
            run_cli(
                self.root,
                "update",
                ep_id,
                "--json",
                stdin_data=json.dumps({
                    "append": "Ordered for $59.",
                    "remove_topics": ["finance/home-budget"],
                    "add_topics": {"orders/desk-mat": "Ordered wool felt mat for $59"},
                }),
            ).stdout
        )
        self.assertEqual(upd["when"], orig_when)
        self.assertTrue(upd["updated"])
        self.assertEqual(
            upd["topics"],
            {"gear/desk-mat": "Pick desk mat under $75", "orders/desk-mat": "Ordered wool felt mat for $59"},
        )

        # Setting and clearing optional kind ('rule')
        as_rule = json.loads(run_cli(self.root, "update", ep_id, "--kind", "rule").stdout)
        self.assertEqual(as_rule["kind"], "rule")
        cleared = json.loads(run_cli(self.root, "update", ep_id, "--json", stdin_data=json.dumps({"kind": ""})).stdout)
        self.assertNotIn("kind", cleared)

        # Removing all topics is rejected.
        empty_topics = run_cli(
            self.root,
            "update",
            ep_id,
            "--json",
            stdin_data=json.dumps({"remove_topics": ["gear/desk-mat", "orders/desk-mat"]}),
            check=False,
        )
        self.assertNotEqual(empty_topics.returncode, 0)

        bad = run_cli(self.root, "update", ep_id, "--append", "nope", "--expected-updated", "wrong-ts", check=False)
        self.assertNotEqual(bad.returncode, 0)
        self.assertIn("Conflict", bad.stderr)

        self.assertEqual(json.loads(run_cli(self.root, "delete", ep_id).stdout)["action"], "archived")
        self.assertEqual(json.loads(run_cli(self.root, "list").stdout)["count"], 0)
        self.assertEqual(json.loads(run_cli(self.root, "restore", ep_id).stdout)["action"], "restored")
        self.assertEqual(json.loads(run_cli(self.root, "list").stdout)["count"], 1)

    def test_validation_rejects_legacy_keys_bad_topics_and_non_allowlisted_kind(self) -> None:
        for bad_payload in (
            {"topics": {"test": "T"}, "title": "T", "body": "B"},
            {"topics": {"test": "T"}, "tags": ["x"], "body": "B"},
            {"topic": "test", "body": "B"},
            {"topics": ["test"], "body": "B"},
            {"topics": {}, "body": "B"},
            {"topics": {"test": ""}, "body": "B"},
            {"topics": {"test": "line1\nline2"}, "body": "B"},
            {"kind": "event", "topics": {"test": "T"}, "body": "B"},
            {"kind": "decision", "topics": {"test": "T"}, "body": "B"},
        ):
            proc = run_cli(self.root, "create", "--json", stdin_data=json.dumps(bad_payload), check=False)
            self.assertNotEqual(proc.returncode, 0, bad_payload)

        ep = json.loads(
            run_cli(
                self.root,
                "create",
                "--json",
                stdin_data=json.dumps({"topics": {"test": "T"}, "body": "B"}),
            ).stdout
        )
        for bad_upd_payload in ({"add_tags": ["done"]}, {"title": "X"}, {"kind": "note"}):
            bad_upd = run_cli(self.root, "update", ep["id"], "--json", stdin_data=json.dumps(bad_upd_payload), check=False)
            self.assertNotEqual(bad_upd.returncode, 0, bad_upd_payload)

        bad_dur = run_cli(self.root, "list", "--since", "30m", check=False)
        self.assertNotEqual(bad_dur.returncode, 0)
        self.assertIn("mo", bad_dur.stderr)

        bad_root = run_cli(ENGINE_DIR, "topics", check=False)
        self.assertNotEqual(bad_root.returncode, 0)
        self.assertIn("Thoth engine directory", bad_root.stderr)

    def test_date_ranges_multi_topic_summaries_rules_and_source_search(self) -> None:
        rows = [
            {
                "when": "2026-10-28 09:00:00",
                "topics": {
                    "orders/widget": "Widget refund block moved to 12:30",
                    "home/office-chair": "Costco chair shopping block moved to 12:30",
                },
                "sources": ["https://shop.example.com/order/991"],
                "body": "Follow up at 12:30",
            },
            {
                "when": "2026-11-10 10:00:00",
                "kind": "rule",
                "topics": {"vehicles/ev-search": "Require physical NACS port"},
                "sources": ["https://other.example.com/item/1"],
                "body": "Always require a physical NACS port.",
            },
            {
                "when": "2026-11-18 18:00:00",
                "kind": "rule",
                "topics": {
                    "agent/scheduling": "Combine same-location errands before adding a second trip",
                    "home/office-chair": "Caught duplicate Costco trip for chair try-out",
                },
                "body": "Check same-day errands before adding a second trip.",
            },
        ]
        for r in rows:
            run_cli(self.root, "create", "--json", stdin_data=json.dumps(r))

        r1 = json.loads(run_cli(self.root, "list", "--since", "2026-10-25", "--until", "2026-11-12").stdout)
        self.assertEqual(r1["count"], 2)

        chair = json.loads(run_cli(self.root, "list", "--topic", "home/office-chair").stdout)
        self.assertEqual(chair["count"], 2)
        self.assertEqual(chair["episodes"][0]["topics"]["home/office-chair"], "Costco chair shopping block moved to 12:30")

        both = json.loads(run_cli(self.root, "list", "--topic", "home/office-chair", "--topic", "orders").stdout)
        self.assertEqual(both["count"], 1)

        rules = json.loads(run_cli(self.root, "list", "--kind", "rule").stdout)
        self.assertEqual(rules["count"], 2)

        # Search matches per-topic summaries as well as URLs and body.
        url_hit = json.loads(run_cli(self.root, "search", "https://shop.example.com/order/991").stdout)
        self.assertEqual(url_hit["count"], 1)
        sum_hit = json.loads(run_cli(self.root, "search", "duplicate").stdout)
        self.assertEqual(sum_hit["count"], 1)

        # Topics index reports each topic's own latest_summary.
        tp = json.loads(run_cli(self.root, "topics").stdout)
        latest = {row["topic"]: (row["count"], row["latest_summary"]) for row in tp["topics"]}
        self.assertEqual(latest["orders/widget"], (1, "Widget refund block moved to 12:30"))
        self.assertEqual(latest["home/office-chair"], (2, "Caught duplicate Costco trip for chair try-out"))
        self.assertEqual(latest["agent/scheduling"], (1, "Combine same-location errands before adding a second trip"))

    def test_secret_rejection_and_parallel_flock(self) -> None:
        for bad_payload in (
            {"topics": {"sec": "Key"}, "body": "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234"},
            {"topics": {"sec": "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234"}, "body": "Body"},
        ):
            bad = run_cli(self.root, "create", "--json", stdin_data=json.dumps(bad_payload), check=False)
            self.assertNotEqual(bad.returncode, 0)
            self.assertIn("API key", bad.stderr)

        def worker(i: int) -> dict:
            out = run_cli(
                self.root,
                "create",
                "--json",
                stdin_data=json.dumps({"topics": {"concurrency/test": f"Write {i}"}, "body": f"Payload {i}"}),
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
                "topics": {topic: f"Chair entry {i:02d}"},
                "body": f"Chair research item {i:02d}",
            }
            run_cli(self.root, "create", "--json", stdin_data=json.dumps(payload))

        s1 = json.loads(run_cli(self.root, "search", "chair").stdout)
        self.assertEqual((s1["count"], s1["total"], s1["offset"], s1["limit"], s1["has_more"], s1["next_offset"]), (15, 18, 0, 15, True, 15))

        s2 = json.loads(run_cli(self.root, "search", "chair", "--offset", str(s1["next_offset"])).stdout)
        self.assertEqual((s2["count"], s2["total"], s2["offset"], s2["has_more"]), (3, 18, 15, False))
        self.assertNotIn("next_offset", s2)
        self.assertEqual(len({h["id"] for h in s1["hits"] + s2["hits"]}), 18)

        s_all = json.loads(run_cli(self.root, "search", "chair", "--limit", "0").stdout)
        self.assertEqual((s_all["count"], s_all["total"], s_all["has_more"]), (18, 18, False))
        self.assertNotIn("limit", s_all)

        l1 = json.loads(run_cli(self.root, "list", "--topic", "paging/topic-0", "--limit", "3").stdout)
        self.assertEqual((l1["count"], l1["total"], l1["has_more"], l1["next_offset"]), (3, 6, True, 3))
        l2 = json.loads(run_cli(self.root, "list", "--topic", "paging/topic-0", "--limit", "3", "--offset", "3").stdout)
        self.assertEqual((l2["count"], l2["total"], l2["has_more"]), (3, 6, False))
        self.assertNotIn("next_offset", l2)

        past = json.loads(run_cli(self.root, "list", "--offset", "50").stdout)
        self.assertEqual((past["count"], past["total"], past["offset"], past["has_more"]), (0, 18, 50, False))

        t1 = json.loads(run_cli(self.root, "topics", "--limit", "2").stdout)
        self.assertEqual((t1["count"], t1["total"], t1["has_more"], t1["next_offset"]), (2, 3, True, 2))
        t2 = json.loads(run_cli(self.root, "topics", "--limit", "2", "--offset", "2").stdout)
        self.assertEqual((t2["count"], t2["total"], t2["has_more"]), (1, 3, False))

        for bad_args in (("list", "--limit", "-1"), ("list", "--offset", "-1"), ("search", "chair", "--offset", "-2")):
            proc = run_cli(self.root, *bad_args, check=False)
            self.assertNotEqual(proc.returncode, 0, bad_args)

    def test_search_word_boundaries_and_field_ranking(self) -> None:
        rows = [
            {
                "when": "2026-11-10 10:00:00",
                "topics": {"planning/bot": "Reconciliation skill idea"},
                "body": "Experiment with reconciliation across memories and tasks.",
            },
            {
                "when": "2026-11-11 10:00:00",
                "topics": {"orders/other": "Side mention"},
                "body": "Mentioned Recon once in passing, and chairs once.",
            },
            {
                "when": "2026-11-12 10:00:00",
                "topics": {"home/office-chair-shopping": "Costco DPS Recon try-out"},
                "body": "Sat in the DPS Recon chair at Costco.",
            },
        ]
        for r in rows:
            run_cli(self.root, "create", "--json", stdin_data=json.dumps(r))

        # Word boundary: "Recon" must NOT match "reconciliation"
        recon = json.loads(run_cli(self.root, "search", "Recon").stdout)
        self.assertEqual(recon["total"], 2)
        # Topic summary match ranks strictly ahead of body-only mention
        self.assertIn("home/office-chair-shopping", recon["hits"][0]["topics"])
        self.assertGreater(recon["hits"][0]["score"], recon["hits"][1]["score"])

        # Plural tolerance: "chair" matches "chairs" in body and "office-chair-shopping" in slug
        chair = json.loads(run_cli(self.root, "search", "chair").stdout)
        self.assertEqual(chair["total"], 2)
        self.assertIn("home/office-chair-shopping", chair["hits"][0]["topics"])
        self.assertGreater(chair["hits"][0]["score"], chair["hits"][1]["score"])

        # --exact still allows substring search when explicitly requested
        sub = json.loads(run_cli(self.root, "search", "recon", "--exact").stdout)
        self.assertEqual(sub["total"], 3)


if __name__ == "__main__":
    unittest.main()
