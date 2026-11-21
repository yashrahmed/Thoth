---
name: log-workout
description: Log, count, fix, or remove workout sessions in the owner's Google Doc workout log, mainly to track personal-trainer sessions for billing (including "missed and paid"). Use when the owner says he worked out or missed a session, or asks how many sessions he's had, on which dates, or when he has to pay.
---

# Log Workout

The log is a table (`Date` | `Workout details`) in a Google Doc; it is the source of truth (never move or copy it). The instance's instructions (e.g. `AGENTS.md`) name the doc and any billing rule; if no doc is named, ask and stop. Use the host's Google Docs connector; if none is connected, ask the owner to connect it.

## Entries

- **One row per date.** Resolve "today", "yesterday", "Oct 22" with the current date and timezone; ask only if genuinely ambiguous. Match the existing rows' date format.
- **Never ask for details.** A date alone logs a session; when no details are given, follow the table's existing convention for plain rows (e.g. `No details`).
- "Missed and paid" / "paid and missed" → `Missed and paid` (only when the owner says so).

## Count

Each non-blank dated row is one session; skip the header. Report total, attended, and missed-and-paid for the range asked (default: the whole current log), with dates when asked. After every add or change, report the updated counts.

"When do I pay?" needs the instance's billing rule (e.g. every N sessions, or monthly); without one, give the counts and say no rule is set. Never guess a rule.

## Edit

1. **Read first** (with the doc's revision) and find the affected rows. Adding an existing date: same content → report it, no write; a new status → update that row. If a request matches several rows, ask.
2. **Guarded write:** require the revision you read; on conflict or an uncertain result, re-read before retrying. Insert rows in date order, change only the selected cells, delete rows bottom-up, and keep the header and any extra columns.
3. **Clear all rows only on explicit request**, keeping the header.
4. **Verify:** read the table back; finish a blank or half-filled new row instead of adding another. Report only verified results.
