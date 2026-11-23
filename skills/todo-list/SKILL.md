---
name: todo-list
description: Create, read, list, search, update, complete, archive, or restore to-do tasks via the todo-list CLI. Use when adding, checking, or changing items on the owner's to-do list, or when another skill needs to add or dedupe tasks.
---

# To-Do List (`todo-list`)

Tasks live in `tasks/t-NNNN.md` (archive: `tasks/.archive/`), relative to the folder you launched from (the instance root); the CLI creates folders as needed. **Never hand-create or edit these files,** not even to fix an unreadable one (writes refuse and name the file; report it to the owner). Run `todo-list` from the instance root; if it isn't on `PATH`, use `uv run --project <thoth> todo-list …`. Output is JSON. Flags: `todo-list <cmd> --help`. IDs: `t-0042`, `t-42`, or `42`.

## Model

- `status`: `open` (actionable) · `waiting` (on someone/something) · `done` · `dropped` (decided not to do). `priority`: `high` · `normal` (default) · `low`.
- `due`: deadline. `scheduled`: when to work on it (open) or follow up (waiting). Both stored as local `YYYY-MM-DDTHH:MM`; pass a bare `YYYY-MM-DD` when the time is unknown and it gets `T00:00`. `""` clears on update.
- `source_keys`: `<channel>:<id>` dedupe keys (lowercase channel, no spaces/commas, e.g. `gmail:<msg-id>`, `memory:<episode-id>`). A key stays reserved even when its task is dropped or archived.
- `memory_ids`: linked episode IDs. `revision`: bumps on every write. `notes`: Markdown above the CLI-owned `## Log`; `reason` adds a one-line log entry.

## Read

```sh
todo-list list                                # open + waiting, by due date then priority
todo-list list --actionable                   # doable today
todo-list list --until 2026-11-22T23:59       # earlier of due/scheduled by then (bare date = end of that day); undated always
todo-list list --status all --full            # everything, with notes and log
todo-list list --source <key> --source <key>  # batch dedupe check → matched_keys / unmatched_keys
todo-list search "query, URL, or source key"
todo-list read t-42                           # live or archived; --md for the raw file
```

## Write

Pass JSON on stdin with `--json` (in a POSIX shell use `<<'EOF'`). Unknown keys fail.

- `create`: `title` (required); `status`, `priority`, `due`, `scheduled`, `source_keys`, `memory_ids`, `notes`, `reason`.
- `update`: the same scalars; `source_keys` / `memory_ids` plus `add_` / `remove_` variants; `notes` (replace) or `append`; `reason`; `expected_revision` (integer).

```sh
todo-list create --json <<'EOF'
{"title": "Reply to dentist about Tuesday slot", "due": "2026-11-25", "source_keys": ["gmail:18c2f0a9"], "notes": "Offered Tue 10 AM or Thu 3 PM.", "reason": "from gmail"}
EOF
todo-list update t-42 --json <<'EOF'
{"status": "waiting", "scheduled": "2026-11-24", "reason": "asked for a morning slot", "expected_revision": 1}
EOF
todo-list done t-42 --reason "booked Tue 10 AM"
todo-list delete t-42 --reason "created by mistake"   # archive; `restore t-42` undoes it
```

## Rules

- **Dedupe:** give every channel-sourced task a source key. `create` returns `"action": "existing"` instead of duplicating; batch-check with `list --source`. Attach a key to an existing task with `add_source_keys`.
- **Prefer `dropped` over `delete`:** dropped tasks stay in history and block re-adding. `delete` is for mistakes; `--hard` only on explicit request.
- **Read before you write:** pass the `revision` you read as `expected_revision` when an update depends on it; on conflict, re-read and retry.
- **Tasks vs memory:** tasks are current state, memory is history. Link a commitment's task with `memory_ids` + `source_keys: ["memory:<id>"]`; record durable outcomes via the `memory` skill.
- **Grounded, no secrets.** Check the returned JSON (`action`, `id`, `status`, `revision`) before reporting success.
- Commit touched files via the `auto-commit` skill if installed.
