# Health Tracker — Two-Way Google Sheet Sync & Setup

Run this procedure only when the owner asks to sync health data (e.g. `"sync health"`, `"sync the health log"`) or during a scheduled sync — never on routine single-entry recording.

## Sheet Access

- Read `sheets` from `health-track config show` (`spreadsheet_id`, optional `permission_rule_id`, optional `writer`).
- Route all Sheet reads and writes through `harness-selection` (Google Drive / Sheets) when installed; otherwise use native Google Sheets tools or `sheets.writer` (if configured), obeying the instance's external write gate.
- Fetch brief: return `{"tabs": {...}}` with raw rows for all 7 tabs. Push brief: pass `sheet_actions` as the exact payload, authorized by `sheets.permission_rule_id` if set, otherwise the owner's quoted sync request.
- If no Sheets access is available — or `sync-plan` shows pending Sheet changes (including ID writebacks) and no authorized writer is available — stop **before** `sync-apply` without modifying local logs.

## Two-Way Sync

1. **Read live Sheet:** fetch all 7 tabs (`Workouts`, `Meals`, `Weight`, `CPAP`, `Meds`, `Slips`, `Staples`) from `sheets.spreadsheet_id`.
2. **Plan (3-way diff):** pipe the fetched rows (`{"tabs": {"Workouts": [...], ...}}`) into:
   ```sh
   health-track sync-plan --json
   ```
   - Compares local logs/staples, live Sheet rows, and the last-synced snapshot (`health/.sync-state.json`).
   - Require `tabs_checked` to include all 7 tabs (if any are missing, stop). If `clean: true`, run `sync-mark` to refresh the verified baseline and stop.
   - If `invalid_remote_rows` is non-empty, report each tab, row, and error and stop until fixed (then refetch and replan). For `conflicts`, show both sides and ask whether to keep local or remote (re-run with `--prefer local` or `--prefer remote`); never silently overwrite.
3. **Apply local pulls:** once an authorized Sheet writer is confirmed (if pushes/ID writebacks are needed), run `health-track sync-apply --json` (with `--prefer` if chosen) using the same Sheet JSON. This imports manual/remote-added Sheet rows into local JSONL (assigning stable IDs if blank), applies remote edits, archives remote-deleted rows, and outputs exact `sheet_actions` (`push_update` including ID writebacks, `remote_delete`, and `push_append`).
4. **Apply Sheet pushes:** execute `sheet_actions` on Google Sheets in index-safe order:
   - Update `push_update` rows in place by `remote_row_index`.
   - Delete `remote_delete` rows **bottom-up** by `remote_row_index`.
   - Append `push_append` rows.
   - Refetch affected tabs and verify updated/appended rows by ID and value, and deleted IDs by absence. If any push fails, do **not** run `sync-mark`; report what applied, flag any unlanded ID writebacks (re-running `sync-apply` would duplicate them), and stop until reconciled.
5. **Mark baseline:** only after verified readback, run:
   ```sh
   health-track sync-mark
   ```
   Commit any pulled local `health/` changes via `auto-commit` (if tracked) and report verified counts (pushed, pulled, deleted, in sync).

## Initial Sheet Setup (New Instance)

1. Run `health-track export-sheets` to get exact headers and rows for all 7 tabs.
2. Create a Google Sheet titled **Health Log**, create the 7 tabs in order with a bold frozen header row, write initial rows, and verify by readback.
3. Save spreadsheet metadata (and optional `permission_rule_id`) in `health/config.json`:
   ```sh
   health-track config set --json <<'EOF'
   {"sheets": {"spreadsheet_id": "<id>", "title": "Health Log", "url": "<url>"}}
   EOF
   health-track sync-mark
   ```
