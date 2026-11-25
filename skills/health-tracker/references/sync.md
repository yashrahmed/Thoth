# Health Tracker — Two-Way Google Sheet Sync & Setup

Run this procedure when the owner asks to sync health data (e.g. `"sync health"`, `"sync the health log"`) after offline logging or manual edits in Google Sheets.

## Two-Way Sync

1. **Read live Sheet:** read `sheets.spreadsheet_id` from `health-track config show` and fetch all 7 tabs (`Workouts`, `Meals`, `Weight`, `CPAP`, `Meds`, `Slips`, `Staples`) from Google Sheets using the Sheet write path (native Sheets connector, or a subagent/harness with Google Sheets access). If Google Sheets is unreachable or unsupported in this harness, stop cleanly and report that sync requires Google connectivity.
2. **Plan (3-way diff):** pipe the fetched rows (`{"tabs": {"Workouts": [...], ...}}`) into:
   ```sh
   health-track sync-plan --json
   ```
   - Compares local logs/staples, live Sheet rows, and the last-synced snapshot (`health/.sync-state.json`).
   - If `clean: true`, report everything is in sync and stop.
   - If `conflicts` or `invalid_remote_rows` are non-empty, show both sides to the owner and ask whether to keep local or remote (re-run with `--prefer local` or `--prefer remote`); never silently overwrite.
3. **Apply local pulls:** run `health-track sync-apply --json` (with `--prefer` if chosen) using the same Sheet JSON. This imports manual/remote-added Sheet rows into local JSONL (assigning stable IDs if blank), applies remote edits, archives remote-deleted rows, and outputs exact `sheet_actions` (`push_append`, `push_update` including ID writebacks, and `remote_delete`).
4. **Apply Sheet pushes:** execute `sheet_actions` on Google Sheets (via native Sheets connector, or a subagent/harness with Sheets write access—passing any active standing permission rule ID so it can verify authorization on disk):
   - Delete `remote_delete` rows **bottom-up** by `remote_row_index`.
   - Update `push_update` rows in place by `remote_row_index`.
   - Append `push_append` rows.
   - Read back affected ranges to verify.
5. **Mark baseline:** only after verified readback, run:
   ```sh
   health-track sync-mark
   ```
   Report verified counts (pushed, pulled, deleted, in sync).

## Initial Sheet Setup (New Instance)

1. Run `health-track export-sheets` to get exact headers and rows for all 7 tabs.
2. Create a Google Sheet titled **Health Log** (via native Sheets connector, or a subagent/harness with Sheets write access), create the 7 tabs in order with a bold frozen header row, write initial rows, and verify by readback.
3. Save the spreadsheet metadata:
   ```sh
   health-track config set --spreadsheet-id "<id>" --sheet-title "Health Log" --sheet-url "<url>"
   health-track sync-mark
   ```
