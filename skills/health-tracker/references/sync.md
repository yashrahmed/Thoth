# Health Tracker — Two-Way Google Sheet Sync & Setup

Run this procedure only when the owner asks to sync health data (e.g. `"sync health"`, `"sync the health log"`) or during a scheduled sync — never on routine single-entry recording.

## Sheet Access & Delegation

- Read `sheets` from `health-track config show` (`spreadsheet_id`, optional `permission_rule_id`, optional `writer`).
- Use the `harness-selection` skill (Google Drive / Sheets) for all Sheet reads and writes, passing `sheets.permission_rule_id` (if set) for writes so the delegate verifies authorization on disk, skips unrelated workspace/profile reads, and confirms writes by readback.
- If the instance does not use `harness-selection`, use native Google Sheets tools if available or delegate to `sheets.writer` (if configured in `health/config.json`).
- If no Sheets-capable harness or connectivity is available, stop cleanly without modifying local logs and tell the owner sync requires Google Sheets access.

## Two-Way Sync

1. **Read live Sheet:** fetch all 7 tabs (`Workouts`, `Meals`, `Weight`, `CPAP`, `Meds`, `Slips`, `Staples`) from `sheets.spreadsheet_id`.
2. **Plan (3-way diff):** pipe the fetched rows (`{"tabs": {"Workouts": [...], ...}}`) into:
   ```sh
   health-track sync-plan --json
   ```
   - Compares local logs/staples, live Sheet rows, and the last-synced snapshot (`health/.sync-state.json`).
   - If `clean: true`, report everything is in sync and stop.
   - If `conflicts` or `invalid_remote_rows` are non-empty, show both sides to the owner and ask whether to keep local or remote (re-run with `--prefer local` or `--prefer remote`); never silently overwrite.
3. **Apply local pulls:** run `health-track sync-apply --json` (with `--prefer` if chosen) using the same Sheet JSON. This imports manual/remote-added Sheet rows into local JSONL (assigning stable IDs if blank), applies remote edits, archives remote-deleted rows, and outputs exact `sheet_actions` (`push_append`, `push_update` including ID writebacks, and `remote_delete`).
4. **Apply Sheet pushes:** execute `sheet_actions` on Google Sheets:
   - Delete `remote_delete` rows **bottom-up** by `remote_row_index`.
   - Update `push_update` rows in place by `remote_row_index`.
   - Append `push_append` rows.
   - Read back affected ranges to verify.
5. **Mark baseline:** only after verified readback, run:
   ```sh
   health-track sync-mark
   ```
   Commit any pulled local `health/` changes via `auto-commit` (if tracked) and report verified counts (pushed, pulled, deleted, in sync).

## Initial Sheet Setup (New Instance)

1. Run `health-track export-sheets` to get exact headers and rows for all 7 tabs.
2. Create a Google Sheet titled **Health Log**, create the 7 tabs in order with a bold frozen header row, write initial rows, and verify by readback.
3. Save spreadsheet metadata (and optional `writer` / `permission_rule_id`) in `health/config.json`:
   ```sh
   health-track config set --json <<'EOF'
   {"sheets": {"spreadsheet_id": "<id>", "title": "Health Log", "url": "<url>"}}
   EOF
   health-track sync-mark
   ```
