---
name: log-workout
description: Log, count, fix, or remove workout sessions in the owner's Google Doc workout log, mainly to track personal-trainer sessions for billing (including "missed and paid"). Use when the owner says he worked out or missed a session, or asks how many sessions he's had, on which dates, or when he has to pay.
---

# Log Workout

The log is a table (`Date` | `Workout details`) in the owner's Google Doc titled **Workout Log**; it is the source of truth (never move or copy it). Find it by searching Drive for that title; if none or several match, ask. Use the host's Google Drive/Docs connector; if none is connected, ask the owner to connect it.

## Entries

- **One row per date.** Resolve "today", "yesterday", "Oct 22" with the current date and timezone; ask only if genuinely ambiguous. Match the existing rows' date format.
- **Never ask for details.** A date alone logs a session; when no details are given, follow the table's existing convention for plain rows (e.g. `No details`).
- "Missed and paid" / "paid and missed" → `Missed and paid` (only when the owner says so).

## Count

Each non-blank dated row is one trainer session unless noted; skip the header. Report total, attended, and missed-and-paid for the range asked (default: the whole current log), with dates when asked. After every add or change, report the updated counts.

Bring up payment only when the owner asks; then use any rule he states and never guess one.

## Edit

1. **Read first** (with the doc's revision, if exposed) and find the affected rows. Adding an existing date: same content → report it, no write; a new status → update that row. If a request matches several rows, ask.
2. **Guarded write:** require the revision you read; on conflict or an uncertain result, re-read before retrying. Insert rows in date order, change only the selected cells, delete rows bottom-up, and keep the header and any extra columns.
   - **Read-only connector → Codex subagent.** If the host's connector can't edit Doc contents, delegate the write to a Codex subagent: pass the doc ID, the expected current table, the exact row change(s), and these rules. It must fetch the live doc and revision, abort if the table differs from expected, and stop if it can't edit in place. If no Codex subagent can be started, stop and tell the owner.
3. **Clear all rows only on explicit request**, keeping the header.
4. **Verify:** read the table back yourself; finish a blank or half-filled new row instead of adding another. Report only verified results.
