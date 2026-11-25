---
name: health-tracker
description: Log, count, fix, sync, or summarize daily health and workout entries (trainer & solo workouts, meals, weight/waist, CPAP, meds, diet slips) via health-track, with separate two-way sync to the owner's Google Sheet. Use for any workout/trainer session count, food, body, sleep, med, or slip report, "sync health", or a weekly check-in.
---

# Health Tracker (`health-track`)

Data lives in `health/` relative to the instance root: `health/logs/YYYY-MM.jsonl` (archive `.archive/`), `health/staples.json`, and `health/config.json`. **Never hand-edit `health/logs/`;** use `health-track` (`uv run --project <thoth> health-track …`) for every local read and write. Output is JSON (except `report` without `--out`). Flags: `health-track <cmd> --help`.

## Rules

- **Personal-only & no medical advice:** never send health data to external nutrition APIs, third-party clouds, or work instances — the only external write allowed is syncing to the owner's configured personal Google Sheet (`health/config.json` → `sheets.spreadsheet_id`). Flag concerning trends for the owner's doctor; never advise starting, stopping, or changing medication doses.
- **No per-entry memories:** daily logs stay in `health-track` (and sync to the Sheet separately), not `thoth-mem`. Write **one** summary episode via `memory` at each weekly check-in.
- **Record locally, sync separately:** normal `add`, `fix`, `delete`, `restore`, and `staples` operations write **locally only** (fast, offline-safe, no Sheet calls during chat). Only touch Google Sheets when the owner asks to sync (e.g. `"sync health"`) or in a scheduled sync run.
- **Missing days are Unknown, never zero** in summaries and weekly views. Nutrition figures are always labeled as estimates (`est.`).

## Log, Read, Fix, Delete

Resolve relative dates/times in local timezone; ask only if genuinely ambiguous. Check returned `id`, `revision`, and `day_totals` / `workout_counts` before confirming.

- **`workout`** — `--kind trainer|solo --status attended|missed|missed_and_paid` (optional `--duration-min`, `--exercises`, `--fasted`, `--notes`). **Never ask for details** (a date alone logs `attended`; `"missed and paid"` → `missed_and_paid`). Report updated trainer counts (`billable`, `attended`, `missed_and_paid`) after every workout change; bring up payment only when asked and never guess a rule.
- **`meal`** — check `health-track staples list` first so recurring foods always count the same; use `--staple <slug>[:<qty>]` or `--json` `items` (custom items require `name`, `kcal`, `protein_g`, `estimated: true`). Offer to save repeated new foods via `health-track staples add`.
- **`weight`** — `--weight-kg` and/or `--waist-in` (at least one), optional `--context`.
- **`cpap`** — `--hours` (required), optional `--ahi`, `--mask-offs`, `--leak-lpm`, `--refreshed yes|somewhat|no`. Log under the wake-up morning date.
- **`med`** — `--name` (lowercase), optional `--dose`, `--status taken|missed|partial|skipped`, `--timing`.
- **`slip`** — `--what` and `--trigger` (required, e.g. `work-escape`, `habit`, `stress`, `social`), optional `--kcal-est`. Don't double-log the same food as both `meal` and `slip`.

```sh
health-track staples list
health-track add workout --kind trainer --status attended --when 2026-11-26
health-track add meal --slot breakfast --staple egg-large:4 --staple chicken-sausage-link:2 --notes "no added salt"
health-track workouts --kind trainer                      # billable, attended, missed_and_paid + dates
health-track list --date 2026-11-25                       # or --since / --until / --type; `read <id>` for one
health-track fix <id> --json <<< '{"ahi": 1.4, "expected_revision": 1}'
health-track delete <id>                                  # archive; `restore <id>` undoes it; --hard only on request
```

Manage staples (`staples add|fix|delete`) and baseline/targets/sheet config (`config show|set`) via `--help`. Commit touched `health/` files via `auto-commit` if tracked in git.

## Sync & Weekly Check-In

- **Two-way Google Sheet sync (`"sync health"`) or Sheet setup:** follow `references/sync.md`.
- **Weekly check-in:** run `health-track summary --days 7` and `health-track report --days 7 --out /tmp/health-weekly.html` (transient temp file), then show the HTML with the host's inline HTML view (`html_preview` then `html_render`), or give the path. After reviewing with the owner, write the single weekly summary episode via `thoth-mem`.
