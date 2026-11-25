---
name: health-tracker
description: Log, count, fix, or delete daily health and workout entries (trainer & solo workouts, meals, weight/waist, CPAP, meds, diet slips), maintain a local staples food catalog, mirror entries to the owner's Google Sheet, and render a weekly check-in HTML view via the health-track CLI. Use when the owner reports workouts (or missed trainer sessions / asks session counts), meals, body measurements, CPAP readouts, medication doses, diet slips, or asks for a health summary or weekly check-in.
---

# Health Tracker (`health-track`)

Local data lives in `health/` relative to the instance root: monthly JSONL logs (`health/logs/YYYY-MM.jsonl`, archive `health/logs/.archive/`), recurring foods (`health/staples.json`), and baseline/targets/sheet metadata (`health/config.json`). **Never hand-edit `health/logs/`;** use `health-track` for every local read and write. Run from the instance root (`uv run --project <thoth> health-track …`). Output is JSON (except `report` without `--out`). Flags: `health-track <cmd> --help`.

## Privacy & Boundaries

- **Personal data only:** never send health logs, meals, weights, or medical details to any external nutrition API, third-party cloud service, or work instance. The only external write allowed is mirroring to the owner's own configured personal Google Sheet (`health/config.json` → `sheets.spreadsheet_id`).
- **No medical advice:** flag concerning trends (e.g. rising AHI, missed meds, persistent stalls) to review with the owner's doctor; never advise starting, stopping, or changing medication doses.
- **No per-entry memory episodes:** daily entries stay in `health-track` (and the Google Sheet mirror), not `thoth-mem`. Write **one** summary episode via the `memory` skill at each weekly check-in (e.g. topic `health/plan` / `health/diet` / `health/sleep`) with headline numbers and decisions.

## Natural Language → Entries

Turn casual messages directly into typed entries (resolve relative dates/times in local timezone; ask only if genuinely ambiguous):

- **`workout`** — absorbs trainer billing and solo workouts:
  - `kind`: `trainer` | `solo`; `status`: `attended` (default) | `missed` | `missed_and_paid`.
  - **Never ask for details.** A date alone logs a session; `"missed and paid"` / `"paid and missed"` → `status: "missed_and_paid"`.
  - After every workout add, fix, or delete, report updated trainer counts (`billable`, `attended`, `missed_and_paid`) from `workout_counts` or `health-track workouts --kind trainer`. Bring up payment only when the owner asks; use any rule he states and never guess one.
- **`meal`** — match recurring foods against `health-track staples list` first so the same meal always counts the same. Pass `items: [{"staple": "<slug>", "qty": N}]` (or custom `{"name", "kcal", "protein_g", "estimated": true}`). Always treat and label values as estimates. Offer to save repeated new foods with `health-track staples add`.
- **`weight`** — `weight_kg` and/or `waist_in` (at least one), optional `context` (e.g. `"morning-fasted"`).
- **`cpap`** — `hours` (required), optional `ahi`, `mask_offs`, `leak_lpm`, `refreshed` (`yes`/`somewhat`/`no`), `notes`. Log under the wake-up morning date.
- **`med`** — `name` (lowercase), optional `dose`, `status` (`taken` default, `missed`, `partial`, `skipped`), `timing`.
- **`slip`** — `what` and `trigger` (both required, e.g. `work-escape`, `habit`, `stress`, `boredom`, `social`, `hunger`), optional `kcal_est`, `notes`. Don't double-log the same food as both `meal` and `slip`.

```sh
health-track staples list
health-track add workout --kind trainer --status attended --when 2026-11-26
health-track add workout --kind trainer --status missed_and_paid --when 2026-11-24
health-track workouts --kind trainer              # billable, attended, missed_and_paid + dates
health-track add meal --json <<'EOF'
{"slot": "breakfast", "items": [{"staple": "egg-large", "qty": 4}, {"staple": "chicken-sausage-link", "qty": 2}], "notes": "no added salt"}
EOF
health-track add cpap --hours 6.0 --ahi 1.5 --mask-offs 2 --refreshed somewhat
health-track add weight --weight-kg 92.4 --waist-in 38.5 --context morning-fasted
health-track add med --name metformin --dose "500 mg ER" --timing after-dinner
health-track add slip --what "pastry on drive home" --trigger work-escape
```

## Read, Fix, Delete

```sh
health-track list --date 2026-11-25              # single day (or --since / --until / --type)
health-track read h-20261125-085000-a1b2         # live or archived
health-track fix h-20261125-085000-a1b2 --json <<'EOF'
{"ahi": 1.4, "expected_revision": 1}
EOF
health-track delete h-20261125-085000-a1b2       # archive; `restore <id>` undoes it; --hard only on request
```

Check the returned JSON (`id`, `revision`, and `day_totals` / `workout_counts`) before confirming to the owner.

## Google Sheet Mirror (Graceful Offline Fallback)

When `health/config.json` configures `sheets.spreadsheet_id`, mirror every local write to the matching worksheet tab in that spreadsheet:

- **Tabs:** `Workouts`, `Meals`, `Weight`, `CPAP`, `Meds`, `Slips`, `Staples`.
- **Stable ID matching:** every log tab stores the entry `ID` in its last column (`Slug` in column A for `Staples`). On `add`, append `sheet_row.row`; on `fix`, update the row matching that `ID`; on `delete`, remove the row matching that `ID` (clear all rows in a tab only on explicit request, keeping the header).
- **Local first, never block on Google:** always write locally via `health-track` first. Then attempt to mirror to Google Sheets (delegating the Sheet write to a **Codex subagent** if the active host lacks native Sheets write tools, and verifying by readback). After a verified mirror write, run `health-track sync-mark` if the Sheet was already in sync.
- **Fail gracefully:** if Google connectivity is down, auth fails, or the current harness has neither Sheets write tools nor a Codex subagent available, **keep the local entry intact** — do not roll it back or error out. Report the saved local `ID` (and `day_totals` / `workout_counts`), explicitly state that the Google Sheet wasn't updated because Google access isn't available right now, and remind the owner they can run **sync** later.

## Sync (Two-Way Reconciliation)

Use when the owner asks to sync health data (e.g. "sync health", "sync the health log") after offline logging or manual edits in Google Sheets:

1. **Read** `health/config.json` (`sheets.spreadsheet_id`) and fetch all 7 tabs (`Workouts`, `Meals`, `Weight`, `CPAP`, `Meds`, `Slips`, `Staples`) from Google Sheets (directly or via Codex subagent). If Google Sheets is unreachable or unsupported in this harness, stop cleanly and report that sync requires Google Sheets connectivity.
2. **Plan (3-way diff):** pipe the live Sheet rows JSON (`{"tabs": {"Workouts": [...], ...}}`) into `health-track sync-plan --json`.
   - Compares local logs/staples, live Sheet rows, and the last-synced baseline (`health/.sync-state.json`).
   - If `clean: true`, report everything is already in sync and stop.
   - If `conflicts` or `invalid_remote_rows` are non-empty, show both sides to the owner and ask whether to keep local or remote (re-run with `--prefer local` or `--prefer remote`), rather than silently overwriting.
3. **Apply local pulls:** run `health-track sync-apply --json` with the same Sheet rows JSON (and `--prefer` if chosen). This imports manual/remote-added Sheet rows into local JSONL (assigning stable IDs if blank), applies remote edits, archives remote-deleted rows, and outputs exact `sheet_actions` (`push_append`, `push_update`, `remote_delete`, plus ID writebacks for manual Sheet rows).
4. **Apply Sheet pushes:** execute `sheet_actions` on the Google Sheet (delete rows bottom-up by `remote_row_index`, update changed/ID-writeback rows in place, append new rows), via native Sheets connector or Codex subagent. Read back affected tabs to verify.
5. **Mark synced:** once verified, run `health-track sync-mark` to update `health/.sync-state.json`, and report exact counts (pushed, pulled, deleted, verified).

## Weekly Check-In View

```sh
health-track summary --days 7                    # JSON totals (missing days are null/unknown, never 0)
health-track report --days 7 --out /tmp/health-weekly.html
```

Show the rendered HTML with the host's inline HTML view (e.g. `html_preview` then `html_render`), or give the file path. Missing days must stay **Unknown**, never zero. After reviewing the check-in with the owner, log one concise summary episode via `thoth-mem`.

## Config, Staples & Commit

- Configure baseline, targets, and Google Sheet metadata via `health-track config set --json` (`baseline`, `targets`, `sheets`).
- Manage recurring foods via `health-track staples add|fix|delete`.
- If the instance tracks `health/` in git (not gitignored), commit touched files via `auto-commit` at turn end.
- **Not in v1:** craving-check flow, lab PDF parsing, and doctor-visit packets (leave room for future entry types/reports).
