---
name: todo-list
description: Create, read, list, search, update, complete, archive, or restore to-do tasks via the todo-list CLI. Use when adding, checking, or changing items on the owner's to-do list, or when another skill (such as intake) needs to add or dedupe tasks.
---

# To-Do List (`todo-list`)

Manage the owner's continually updating to-do list, stored as **1 Markdown + YAML frontmatter file per task** under `<root>/tasks/t-NNNN.md` (soft-deleted tasks live in `<root>/tasks/.archive/`).

**Hard rule:** Never hand-create or edit files under `tasks/`. Perform every write through `todo-list` (OS file lock, atomic writes, strict JSON keys, secret scanning, revision checks, and the CLI-owned `## Log`).

## Invocation

Run from the active instance folder (the default root), or pass `--root <instance-dir>` / set `THOTH_ROOT`. If `todo-list` is not on `PATH`, use `uv run --project <Thoth> todo-list ...` (**not** `--directory`). The CLI refuses to use the Thoth engine directory as a root. Every command prints JSON; errors go to stderr as `{"ok": false, "error": ...}`.

IDs look like `t-0042`; every command also accepts `t-42` or `42`.

## Task model

| Field | Meaning |
|---|---|
| `title` | One-line action ("Reply to dentist about Tuesday slot") |
| `status` | `open` (actionable) · `waiting` (on someone/something) · `done` · `dropped` (decided not to do) |
| `priority` | `high` · `normal` (default) · `low` |
| `due` | Deadline, `YYYY-MM-DD` |
| `scheduled` | When to work on it (open) or follow up (waiting), `YYYY-MM-DD` |
| `source_keys` | `<channel>:<id>` dedupe keys: lowercase channel, no spaces or commas (`gmail:<msg-id>`, `gcal:<event-id>`, `t3:<thread-id>`, `memory:<episode-id>`). Each key belongs to one task, forever (incl. dropped/archived). |
| `memory_ids` | Related episode IDs (e.g. the commitment behind the task) |
| `revision` | Increments on every write; pass `expected_revision` to refuse stale writes |
| `notes` | Free-form Markdown (links, `- [ ]` checklists). Stored above the CLI-owned `## Log` (`time \| change \| reason`), which `read` returns as `log`. |

## 1. Read path

```sh
todo-list list                         # open + waiting, sorted by due date, then priority
todo-list list --actionable            # what can be done today (open not scheduled later + waiting whose follow-up date has come)
todo-list list --due-by 2026-11-30     # due on or before a date
todo-list list --status all --full     # everything, with notes and log
todo-list search "dentist"             # keyword / exact URL / source key search
todo-list read t-42                    # one task (live or archived), JSON; add --md for the raw file
```

When showing tasks to the owner, keep it compact: a short table of ID, title, due/scheduled, and status. No walls of text.

## 2. Write path

Always use `--json <<'EOF'` for create/update so `$`, quotes, and backticks survive. Unknown keys are rejected.

- **`create` keys:** `title` (required); `status`, `priority`, `due`, `scheduled`, `source_keys`, `memory_ids`, `notes`, `reason` (optional).
- `notes` is the multi-line Markdown notes field (same name `read` returns); `reason` is a one-line explanation written to the `## Log`.
- **`update` keys:** `title`, `status`, `priority`, `due`, `scheduled` (`""` clears a date), `source_keys` / `add_source_keys` / `remove_source_keys`, `memory_ids` / `add_memory_ids` / `remove_memory_ids`, `notes` (replace), `append` (add to notes), `reason` (log), `expected_revision` (JSON integer).

```sh
todo-list create --json <<'EOF'
{
  "title": "Reply to dentist about Tuesday slot",
  "due": "2026-11-25",
  "source_keys": ["gmail:18c2f0a9"],
  "notes": "They offered Tue 10 AM or Thu 3 PM.",
  "reason": "from Gmail"
}
EOF

todo-list update t-42 --json <<'EOF'
{"status": "waiting", "scheduled": "2026-11-24", "reason": "asked for a morning slot", "expected_revision": 1}
EOF

todo-list done t-42 --reason "booked Tue 10 AM"
todo-list update t-42 --status dropped --reason "no longer needed"
todo-list delete t-42 --reason "created by mistake"   # soft-delete to tasks/.archive/; source keys stay reserved
todo-list restore t-42
```

### Rules
- **Dedupe before creating.** Give every task that came from a channel a `source_keys` entry. `create` returns `"action": "existing"` (with `matched_keys` / `unmatched_keys`) instead of duplicating; to check many keys at once without writing, run `todo-list list --source <key> --source <key>` and read `matched_keys` / `unmatched_keys`. Attaching a new key to an existing task is an explicit `update` with `add_source_keys`.
- **Prefer `dropped` over `delete`.** Dropped tasks stay visible in history and keep intake from re-adding them. Use `delete` only for mistakes; never `--hard` unless the owner explicitly asks.
- **Read before you write.** `read` the task, then pass its `revision` as `expected_revision` when an update depends on what you read. On a conflict, re-read and retry.
- **Tasks vs memory.** The to-do list is current state; memory is history. Don't copy every task into memory. When a task comes from a commitment, link it (`memory_ids: ["<id>"]`, `source_keys: ["memory:<id>"]`). When finishing a task produces a durable outcome or decision, record that via the `memory` skill.
- **Grounded only.** Create tasks from what the owner said or what a source actually contains. Never store secrets; the CLI rejects common key/token patterns.
- **Verify writes.** Check the returned JSON (`action`, `id`, `status`, `revision`) before reporting success.
- **Unreadable task file?** Writes refuse to run and name the file. Report it to the owner; never hand-edit `tasks/` to fix it.
