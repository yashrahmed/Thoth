"""Tests for health-track CLI: typed entries, staples, trainer billing counts, Google Sheets export, monthly JSONL, HTML report, secrets, flock."""

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
        ["uv", "run", "-q", "--directory", str(ENGINE_DIR), "health-track", "--root", str(root), *args],
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


class TestHealthTrackCLI(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def add_json(self, entry_type: str, payload: dict, check: bool = True) -> subprocess.CompletedProcess:
        return run_cli(self.root, "add", entry_type, "--json", stdin_data=json.dumps(payload), check=check)

    def test_staples_and_consistent_meal_totals(self) -> None:
        s1 = j(run_cli(
            self.root, "staples", "add", "egg-large",
            "--name", "Large egg", "--unit", "egg", "--kcal", "72", "--protein", "6.3",
            "--alias", "egg,eggs", "--notes", "USDA estimate",
        ))
        self.assertTrue(s1["ok"])
        self.assertTrue(s1["staple"]["estimated"])

        run_cli(
            self.root, "staples", "add", "turkey-sausage",
            "--name", "Turkey sausage link", "--unit", "link", "--kcal", "90", "--protein", "8.0",
        )

        # Log the same meal twice (once by slug, once by alias) -> exact same macros
        m1 = j(self.add_json("meal", {
            "when": "2026-10-10 08:30",
            "slot": "breakfast",
            "items": [{"staple": "egg-large", "qty": 4}, {"staple": "turkey-sausage", "qty": 2}],
        }))
        m2 = j(self.add_json("meal", {
            "when": "2026-10-11 08:30",
            "slot": "breakfast",
            "items": [{"staple": "eggs", "qty": 4}, {"staple": "turkey-sausage", "qty": 2}],
        }))
        self.assertEqual(m1["entry"]["kcal"], 468.0)
        self.assertEqual(m1["entry"]["protein_g"], 41.2)
        self.assertEqual(m1["entry"]["kcal"], m2["entry"]["kcal"])
        self.assertEqual(m1["entry"]["protein_g"], m2["entry"]["protein_g"])
        self.assertTrue(m1["entry"]["estimated"])
        self.assertEqual(m1["day_totals"]["protein_g"], 41.2)
        self.assertEqual(m1["sheet_row"]["tab"], "Meals")
        self.assertEqual(m1["sheet_row"]["row"][-1], m1["entry"]["id"])

        # Updating staple doesn't mutate already-logged historical meal
        run_cli(self.root, "staples", "fix", "turkey-sausage", "--kcal", "100", "--protein", "9")
        hist = j(run_cli(self.root, "read", m1["entry"]["id"]))["entry"]
        self.assertEqual(hist["kcal"], 468.0)

        # Delete staple works
        d = j(run_cli(self.root, "staples", "delete", "turkey-sausage"))
        self.assertEqual(d["action"], "deleted")
        listed = j(run_cli(self.root, "staples", "list"))
        self.assertEqual(listed["count"], 1)

    def test_all_six_types_crud_fix_across_months_and_archive(self) -> None:
        w = j(self.add_json("weight", {"when": "2026-10-31 07:00", "weight_kg": 95.2, "waist_in": 39.5, "context": "morning-fasted"}))
        c = j(self.add_json("cpap", {"when": "2026-10-31 07:10", "hours": 6.5, "ahi": 1.4, "mask_offs": 1, "refreshed": "yes"}))
        md = j(self.add_json("med", {"when": "2026-10-31 20:00", "name": "Metformin", "dose": "500 mg ER", "timing": "after-dinner"}))
        wk = j(self.add_json("workout", {"when": "2026-10-31 06:00", "kind": "trainer", "status": "attended", "duration_min": 50, "exercises": 9, "fasted": True}))
        sl = j(self.add_json("slip", {"when": "2026-10-31 17:30", "what": "bakery muffin", "trigger": "Work-Escape", "kcal_est": 420}))
        ml = j(self.add_json("meal", {"when": "2026-10-31 12:30", "slot": "lunch", "description": "Grilled chicken bowl", "kcal": 620, "protein_g": 55}))

        self.assertRegex(w["entry"]["id"], r"^h-20261031-070000-[0-9a-f]{4}$")
        self.assertEqual(md["entry"]["name"], "metformin")
        self.assertEqual(sl["entry"]["trigger"], "work-escape")
        self.assertEqual(ml["path"], "health/logs/2026-10.jsonl")
        self.assertEqual(wk["workout_counts"]["billable"], 1)
        self.assertEqual(wk["sheet_row"]["tab"], "Workouts")

        listed = j(run_cli(self.root, "list", "--date", "2026-10-31"))
        self.assertEqual(listed["count"], 6)

        # Fix entry and move it across month boundary (Oct -> Nov)
        fixed = j(run_cli(
            self.root, "fix", c["entry"]["id"], "--json",
            stdin_data=json.dumps({"when": "2026-11-01 07:15", "ahi": 1.2, "expected_revision": 1}),
        ))
        self.assertEqual(fixed["action"], "fixed")
        self.assertEqual(fixed["entry"]["revision"], 2)
        self.assertEqual(fixed["entry"]["ahi"], 1.2)
        self.assertEqual(fixed["path"], "health/logs/2026-11.jsonl")
        self.assertEqual(fixed["sheet_row"]["tab"], "CPAP")
        self.assertTrue((self.root / "health" / "logs" / "2026-11.jsonl").exists())

        # Stale revision rejected
        stale = run_cli(
            self.root, "fix", c["entry"]["id"], "--ahi", "1.9", "--expected-revision", "1", check=False
        )
        self.assertNotEqual(stale.returncode, 0)
        self.assertIn("Conflict", stale.stderr)

        # Unchanged fix does not bump revision
        same = j(run_cli(self.root, "fix", c["entry"]["id"], "--ahi", "1.2"))
        self.assertEqual(same["action"], "unchanged")
        self.assertEqual(same["entry"]["revision"], 2)

        # Soft delete -> archive -> restore -> hard delete
        arch = j(run_cli(self.root, "delete", sl["entry"]["id"]))
        self.assertEqual(arch["action"], "archived")
        self.assertEqual(j(run_cli(self.root, "list", "--type", "slip"))["count"], 0)
        self.assertTrue(j(run_cli(self.root, "read", sl["entry"]["id"]))["archived"])

        rest = j(run_cli(self.root, "restore", sl["entry"]["id"]))
        self.assertEqual(rest["action"], "restored")
        self.assertEqual(j(run_cli(self.root, "list", "--type", "slip"))["count"], 1)

        hard = j(run_cli(self.root, "delete", wk["entry"]["id"], "--hard"))
        self.assertEqual(hard["action"], "hard_deleted")
        self.assertNotEqual(run_cli(self.root, "read", wk["entry"]["id"], check=False).returncode, 0)

    def test_trainer_workout_counts_and_export_sheets(self) -> None:
        run_cli(
            self.root, "config", "set",
            "--spreadsheet-id", "sheet-abc-123",
            "--sheet-title", "Health Log",
            "--sheet-url", "https://docs.google.com/spreadsheets/d/sheet-abc-123/edit",
        )
        run_cli(
            self.root, "staples", "add", "egg-large",
            "--name", "Large egg", "--unit", "egg", "--kcal", "72", "--protein", "6.3",
        )
        run_cli(self.root, "add", "workout", "--when", "2026-10-02", "--kind", "trainer", "--status", "attended")
        w2 = j(run_cli(self.root, "add", "workout", "--when", "2026-10-04", "--kind", "trainer", "--status", "missed_and_paid"))
        run_cli(self.root, "add", "workout", "--when", "2026-10-05", "--kind", "solo", "--status", "attended")
        run_cli(self.root, "add", "workout", "--when", "2026-10-06", "--kind", "trainer", "--status", "missed")

        self.assertEqual(w2["workout_counts"]["billable"], 2)
        self.assertEqual(w2["workout_counts"]["attended"], 1)
        self.assertEqual(w2["workout_counts"]["missed_and_paid"], 1)

        tr = j(run_cli(self.root, "workouts", "--kind", "trainer"))
        self.assertEqual((tr["total"], tr["attended"], tr["missed_and_paid"], tr["missed"], tr["billable"]), (3, 1, 1, 1, 2))

        all_w = j(run_cli(self.root, "workouts", "--kind", "all"))
        self.assertEqual(all_w["total"], 4)

        exp = j(run_cli(self.root, "export-sheets"))
        self.assertEqual(exp["sheets"]["spreadsheet_id"], "sheet-abc-123")
        self.assertEqual(set(exp["tabs"].keys()), {"Workouts", "Meals", "Weight", "CPAP", "Meds", "Slips", "Staples"})
        self.assertEqual(len(exp["tabs"]["Workouts"]["rows"]), 4)
        self.assertEqual(len(exp["tabs"]["Staples"]["rows"]), 1)

    def test_summary_and_weekly_html_keep_missing_days_unknown(self) -> None:
        run_cli(
            self.root, "config", "set", "--json",
            stdin_data=json.dumps({
                "baseline": {"weight_kg": 96.0, "waist_in": 40.0, "date": "2026-10-01"},
                "targets": {
                    "protein_g_min": 140,
                    "kcal_max": 2000,
                    "cpap_hours_min": 6.0,
                    "cpap_ahi_max": 5.0,
                    "meds": [{"name": "metformin", "dose": "500 mg ER", "expected_per_day": 1}],
                },
            }),
        )

        # Log only 3 days inside a 7-day window (2026-10-10 .. 2026-10-16)
        self.add_json("weight", {"when": "2026-10-11 07:00", "weight_kg": 95.4, "waist_in": 39.5})
        self.add_json("weight", {"when": "2026-10-15 07:00", "weight_kg": 94.8})
        self.add_json("meal", {"when": "2026-10-11 12:00", "description": "Day 1 meals", "kcal": 1750, "protein_g": 152})
        self.add_json("meal", {"when": "2026-10-12 12:00", "description": "Day 2 meals", "kcal": 1600, "protein_g": 120})
        self.add_json("meal", {"when": "2026-10-15 12:00", "description": "Day 5 meals", "kcal": 1820, "protein_g": 148})
        self.add_json("cpap", {"when": "2026-10-11 07:00", "hours": 6.2, "ahi": 1.4, "mask_offs": 1})
        self.add_json("cpap", {"when": "2026-10-15 07:00", "hours": 7.0, "ahi": 1.0, "mask_offs": 0})
        self.add_json("med", {"when": "2026-10-11 20:00", "name": "metformin", "status": "taken"})
        self.add_json("med", {"when": "2026-10-12 20:00", "name": "metformin", "status": "missed"})
        self.add_json("workout", {"when": "2026-10-11 06:00", "kind": "trainer", "status": "missed_and_paid"})
        self.add_json("slip", {"when": "2026-10-12 18:00", "what": "<script>alert(1)</script> donut", "trigger": "habit"})

        sm = j(run_cli(self.root, "summary", "--since", "2026-10-10", "--until", "2026-10-16"))
        self.assertEqual(sm["total_days"], 7)
        self.assertEqual(sm["weight"]["delta_vs_baseline_kg"], -1.2)
        self.assertEqual(sm["waist"]["delta_vs_baseline_in"], -0.5)
        self.assertEqual(sm["nutrition"]["days_logged"], 3)
        self.assertEqual(sm["nutrition"]["days_unknown"], 4)
        self.assertEqual(sm["nutrition"]["protein_days_hit"], 2)
        self.assertAlmostEqual(sm["nutrition"]["protein_hit_rate"], round(2 / 3, 3))
        self.assertEqual(sm["cpap"]["nights_logged"], 2)
        self.assertEqual(sm["cpap"]["nights_unknown"], 5)
        self.assertEqual(sm["meds"][0]["days_taken"], 1)
        self.assertEqual(sm["meds"][0]["days_missed"], 1)
        self.assertEqual(sm["meds"][0]["days_unknown"], 5)
        self.assertEqual(sm["slips"]["by_trigger"], {"habit": 1})

        # Unlogged day (2026-10-10) must be None, NEVER 0
        day0 = sm["days"][0]
        self.assertEqual(day0["date"], "2026-10-10")
        self.assertIsNone(day0["kcal"])
        self.assertIsNone(day0["protein_g"])
        self.assertIsNone(day0["cpap"])
        self.assertIsNone(day0["meds"]["metformin"])

        out_html = self.root / "weekly.html"
        rep = j(run_cli(self.root, "report", "--since", "2026-10-10", "--until", "2026-10-16", "--out", str(out_html)))
        self.assertTrue(rep["ok"])
        html_text = out_html.read_text(encoding="utf-8")
        self.assertIn("Unknown", html_text)
        self.assertIn("est.", html_text)
        self.assertNotIn("<script>alert(1)</script>", html_text)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html_text)
        self.assertNotIn("http://", html_text)
        self.assertNotIn("https://", html_text)

    def test_validation_secrets_corrupt_jsonl_and_engine_refusal(self) -> None:
        for entry_type, bad in (
            ("meal", {"unknown_key": 1, "description": "x", "kcal": 100, "protein_g": 10}),
            ("weight", {"context": "morning"}),
            ("cpap", {"ahi": 1.2}),
            ("slip", {"what": "cookie"}),
            ("meal", {"description": "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234", "kcal": 100, "protein_g": 10}),
            ("slip", {"what": "snack", "trigger": "stress", "notes": "AKIAABCDEFGHIJKLMNOP"}),
        ):
            proc = self.add_json(entry_type, bad, check=False)
            self.assertNotEqual(proc.returncode, 0, (entry_type, bad))

        # Corrupt JSONL line: reads warn, writes refuse
        self.add_json("weight", {"when": "2026-10-10 08:00", "weight_kg": 90.0})
        log_file = self.root / "health" / "logs" / "2026-10.jsonl"
        log_file.write_text(log_file.read_text(encoding="utf-8") + "{not-json\n", encoding="utf-8")

        listed = j(run_cli(self.root, "list"))
        self.assertEqual(listed["count"], 1)
        self.assertIn("warnings", listed)

        blocked = self.add_json("weight", {"when": "2026-10-11 08:00", "weight_kg": 89.5}, check=False)
        self.assertNotEqual(blocked.returncode, 0)
        self.assertIn("unreadable", blocked.stderr)

        # Refuse engine directory
        eng = subprocess.run(
            ["uv", "run", "-q", "--directory", str(ENGINE_DIR), "health-track", "list"],
            text=True, capture_output=True, check=False,
        )
        self.assertNotEqual(eng.returncode, 0)
        self.assertIn("Refusing to use the Thoth engine directory", eng.stderr)

    def test_three_way_sync_plan_apply_and_mark(self) -> None:
        # Initial synced state: 1 weight, 1 meal, 1 workout, 1 staple
        run_cli(
            self.root, "staples", "add", "egg-large",
            "--name", "Large egg", "--unit", "egg", "--kcal", "72", "--protein", "6.3",
        )
        w1 = j(self.add_json("weight", {"when": "2026-10-10 07:00", "weight_kg": 95.0, "waist_in": 40.0}))["entry"]
        m1 = j(self.add_json("meal", {"when": "2026-10-10 08:30", "slot": "breakfast", "description": "Eggs", "kcal": 300, "protein_g": 25}))["entry"]
        wk1 = j(self.add_json("workout", {"when": "2026-10-10 06:00", "kind": "trainer", "status": "attended"}))["entry"]
        exp0 = j(run_cli(self.root, "export-sheets"))
        mark = j(run_cli(self.root, "sync-mark"))
        self.assertTrue(mark["ok"])

        # Same rows (even with string numbers from Sheets) => clean
        remote_clean = {
            "tabs": {
                tab: [spec["headers"], *[[str(c) for c in row] for row in spec["rows"]]]
                for tab, spec in exp0["tabs"].items()
            }
        }
        plan0 = j(run_cli(self.root, "sync-plan", "--json", stdin_data=json.dumps(remote_clean)))
        self.assertTrue(plan0["clean"])
        self.assertEqual(plan0["counts"]["in_sync"], 4)

        # Simulate offline local changes + manual remote Sheet changes:
        # - Local: add cpap (offline), fix m1 kcal -> 350, delete wk1
        # - Remote: edit w1 weight_kg 95.0 -> 94.5, add manual meal with blank ID
        c_new = j(self.add_json("cpap", {"when": "2026-10-11 07:00", "hours": 6.5, "ahi": 1.2}))["entry"]
        run_cli(self.root, "fix", m1["id"], "--kcal", "350")
        run_cli(self.root, "delete", wk1["id"])

        remote_changed = json.loads(json.dumps(remote_clean))
        remote_changed["tabs"]["Weight"][1][2] = "94.5"  # edited in Sheet
        remote_changed["tabs"]["Meals"].append(["2026-10-11", "12:30", "lunch", "Manual Sheet salad", "450", "38", "from phone", ""])

        plan1 = j(run_cli(self.root, "sync-plan", "--json", stdin_data=json.dumps(remote_changed)))
        self.assertFalse(plan1["clean"])
        self.assertEqual(plan1["counts"]["push_append"], 1)    # c_new
        self.assertEqual(plan1["counts"]["push_update"], 1)    # m1
        self.assertEqual(plan1["counts"]["remote_delete"], 1)  # wk1 archived locally
        self.assertEqual(plan1["counts"]["pull_update"], 1)    # w1 edited in Sheet
        self.assertEqual(plan1["counts"]["pull_add"], 1)       # manual Sheet meal
        self.assertEqual(plan1["counts"]["conflicts"], 0)
        self.assertEqual(plan1["push_append"][0]["id"], c_new["id"])

        applied = j(run_cli(self.root, "sync-apply", "--json", stdin_data=json.dumps(remote_changed)))
        self.assertEqual(len(applied["applied"]["pulled_added"]), 1)
        self.assertEqual(len(applied["applied"]["pulled_updated"]), 1)
        # w1 updated locally to 94.5
        self.assertEqual(j(run_cli(self.root, "read", w1["id"]))["entry"]["weight_kg"], 94.5)
        # push_update includes both m1 update and ID writeback for the manual Sheet meal
        self.assertEqual(len(applied["sheet_actions"]["push_update"]), 2)
        self.assertEqual(len(applied["sheet_actions"]["push_append"]), 1)
        self.assertEqual(len(applied["sheet_actions"]["remote_delete"]), 1)

        # True conflict: both local and remote edit w1 differently after mark
        run_cli(self.root, "sync-mark")
        run_cli(self.root, "fix", w1["id"], "--weight-kg", "94.2")
        exp1 = j(run_cli(self.root, "export-sheets"))
        remote_conflict = {"tabs": {tab: [spec["headers"], *spec["rows"]] for tab, spec in exp1["tabs"].items()}}
        remote_conflict["tabs"]["Weight"][1][2] = 93.9
        cplan = j(run_cli(self.root, "sync-plan", "--json", stdin_data=json.dumps(remote_conflict)))
        self.assertEqual(cplan["counts"]["conflicts"], 1)
        # sync-apply refuses unresolved conflict
        blocked = run_cli(self.root, "sync-apply", "--json", stdin_data=json.dumps(remote_conflict), check=False)
        self.assertNotEqual(blocked.returncode, 0)
        self.assertIn("conflict", blocked.stderr.lower())
        # --prefer local resolves in favor of push_update
        resolved = j(run_cli(self.root, "sync-plan", "--prefer", "local", "--json", stdin_data=json.dumps(remote_conflict)))
        self.assertEqual(resolved["counts"]["conflicts"], 0)
        self.assertEqual(resolved["counts"]["push_update"], 1)

    def test_parallel_adds_flock(self) -> None:
        def worker(i: int) -> dict:
            return j(self.add_json("weight", {"when": "2026-10-15 08:00:00", "weight_kg": 90.0 + i * 0.1}))

        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(worker, range(10)))
        self.assertEqual(len({r["entry"]["id"] for r in results}), 10)
        self.assertEqual(j(run_cli(self.root, "list"))["count"], 10)


if __name__ == "__main__":
    unittest.main()
