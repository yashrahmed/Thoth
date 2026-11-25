---
name: health-tracker
description: Log, list, fix, or delete daily health entries (meals, weight/waist, CPAP, meds, workouts, diet slips), maintain a local staples food catalog, and render a weekly check-in HTML view via the thoth-health CLI. Use when the owner reports meals, body measurements, CPAP readouts, medication doses, workouts, diet slips, or asks for a health summary or weekly check-in.
---

# Health Tracker (`thoth-health`)

Data lives in `health/` relative to the instance root: monthly JSONL logs (`health/logs/YYYY-MM.jsonl`, archive `health/logs/.archive/`), recurring foods (`health/staples.json`), and baseline/targets (`health/config.json`). **Never hand-edit `health/logs/`;** use `thoth-health` for every read and write. Run from the instance root (`uv run --project <thoth> thoth-health …`). Output is JSON (except `report` without `--out`). Flags: `thoth-health <cmd> --help`.

## Privacy & Boundaries

- **Local only:** never send health logs, meals, weights, or medical details to any external nutrition API, cloud service, or work instance.
- **No medical advice:** flag concerning trends (e.g. rising AHI, missed meds, persistent stalls) to review with the owner's doctor; never advise starting, stopping, or changing medication doses.
- **No per-entry memory episodes:** daily entries stay in `thoth-health`, not `thoth-mem`. Write **one** summary episode via the `memory` skill at each weekly check-in (e.g. topic `health/plan` / `health/diet` / `health/sleep`) with headline numbers and decisions.
- **Keep `log-workout` separate:** trainer sessions update **both** the Google Doc billing log (via `log-workout`) and `thoth-health add workout --kind trainer`. Solo workouts go to `thoth-health` only. You may read the Workout Log doc to cross-check, never write to it from this skill.

## Natural Language → Entries

Turn casual messages directly into typed entries (resolve relative dates/times in local timezone; ask only if genuinely ambiguous):

- **`meal`** — match recurring foods against `thoth-health staples list` first so the same meal always counts the same. Pass `items: [{"staple": "<slug>", "qty": N}]` (or custom `{"name", "kcal", "protein_g", "estimated": true}`). Always treat and label values as estimates. Offer to save repeated new foods with `thoth-health staples add`.
- **`weight`** — `weight_kg` and/or `waist_in` (at least one), optional `context` (e.g. `"morning-fasted"`).
- **`cpap`** — `hours` (required), optional `ahi`, `mask_offs`, `leak_lpm`, `refreshed` (`yes`/`somewhat`/`no`), `notes`. Log under the wake-up morning date.
- **`med`** — `name` (lowercase), optional `dose`, `status` (`taken` default, `missed`, `partial`, `skipped`), `timing`.
- **`workout`** — `kind` (`trainer` | `solo`), `status` (`attended` | `missed` | `missed_and_paid`), optional `duration_min`, `exercises`, `fasted`, `notes`.
- **`slip`** — `what` and `trigger` (both required, e.g. `work-escape`, `habit`, `stress`, `boredom`, `social`, `hunger`), optional `kcal_est`, `notes`. Don't double-log the same food as both `meal` and `slip`.

```sh
thoth-health staples list
thoth-health add meal --json <<'EOF'
{"slot": "breakfast", "items": [{"staple": "egg-large", "qty": 4}, {"staple": "chicken-sausage-link", "qty": 2}], "notes": "no added salt"}
EOF
thoth-health add cpap --json <<'EOF'
{"hours": 6.0, "ahi": 1.5, "mask_offs": 2, "refreshed": "somewhat", "notes": "first wake-up refreshed"}
EOF
thoth-health add weight --weight-kg 92.4 --waist-in 38.5 --context morning-fasted
thoth-health add med --name metformin --dose "500 mg ER" --timing after-dinner
thoth-health add workout --kind trainer --status attended --duration-min 50 --exercises 9 --fasted
thoth-health add slip --what "pastry on drive home" --trigger work-escape
```

## Read, Fix, Delete

```sh
thoth-health list --date 2026-11-25              # single day (or --since / --until / --type)
thoth-health read h-20261125-085000-a1b2         # live or archived
thoth-health fix h-20261125-085000-a1b2 --json <<'EOF'
{"ahi": 1.4, "expected_revision": 1}
EOF
thoth-health delete h-20261125-085000-a1b2       # archive; `restore <id>` undoes it; --hard only on request
```

Check the returned JSON (`id`, `revision`, and `day_totals` on meals) before confirming to the owner.

## Weekly Check-In View

```sh
thoth-health summary --days 7                    # JSON totals (missing days are null/unknown, never 0)
thoth-health report --days 7 --out /tmp/health-weekly.html
```

Show the rendered HTML with the host's inline HTML view (e.g. `html_preview` then `html_render`), or give the file path. Missing days must stay **Unknown**, never zero. After reviewing the check-in with the owner, log one concise summary episode via `thoth-mem`.

## Config, Staples & Commit

- Set baseline/targets once via `thoth-health config set --json` (`baseline`: `weight_kg`, `waist_in`, `date`; `targets`: `protein_g_min`, `kcal_max`, `cpap_hours_min`, `cpap_ahi_max`, `meds`).
- Manage recurring foods via `thoth-health staples add|fix|delete`.
- If the instance tracks `health/` in git (not gitignored), commit touched files via `auto-commit` at turn end.
- **Not in v1:** craving-check flow, lab PDF parsing, and doctor-visit packets (leave room for future entry types/reports).
