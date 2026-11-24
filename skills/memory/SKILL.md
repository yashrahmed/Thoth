---
name: memory
description: Read, search, create, update, or archive episodic memories via the thoth-mem CLI. Use when recalling past events, dates, decisions, rules, or commitments, or when recording new durable facts and updates.
---

# Episodic Memory (`thoth-mem`)

Episodes live in `memory/episodes/YYYY-MM/<id>.md` (archive: `memory/episodes/.archive/`), relative to the folder you launched from (the instance root); the CLI creates folders as needed. **Never hand-create or edit these files;** use `thoth-mem` for every read and write. Run it from the instance root; if it isn't on `PATH`, use `uv run --project <thoth> thoth-mem …`. Flags: `thoth-mem <cmd> --help`.

## Read

Start narrow:

```sh
thoth-mem topics --since 30d                          # discover topics first
thoth-mem list --topic projects/alpha --full          # exact topic or prefix (repeatable for AND); also --since/--until (YYYY-MM-DD or 24h/7d/2w/1mo), --kind
thoth-mem list --kind rule --full                     # standing rules across all topics
thoth-mem search "query or URL"                       # URLs/IDs match literally; --exact to force; default --limit 15 (0 = all)
thoth-mem read <id>
```

- `list`, `search`, and `topics` return `count` (in this response), `total` (all matches), `offset`, `has_more`, and `next_offset` when more exist; page with `--offset` / `--limit`.
- Report the **latest** state: later episodes on a topic supersede earlier ones (compare `when`).
- Nothing found → say it isn't recorded. Never fabricate. Cite episode IDs for key facts and histories.

## Write

- **One episode = one dated occurrence:** a decision, case update, completed action, commitment, or explicit rule. Skip pure Q&A, routine noise, transient tool errors, guesses about the user, and secrets (redact first).
- **Grounded only:** what the user said or what happened; put inference under `## Assistant Note`.
- **Multi-topic:** `topics` is a non-empty list of lowercase `<category>/<slug>` slugs. Reuse existing topics, and include **every** relevant topic when an occurrence spans subjects (e.g. a combined errand or a scheduling lesson tied to a shopping trip).
- **Standing rules:** need explicit intent ("always", "from now on", "stop doing X", "remember"); record with `kind: "rule"` on the relevant topic(s) (or `rules/<slug>` for general rules). Open/done state for commitments lives in `todo-list`, not memory.
- **`create`** for a new development (keeps history append-only). **`update <id>`** for a correction, missed source, or adding/fixing topics (keeps `when`, stamps `updated`).
- Pass JSON on stdin with `--json` (in a POSIX shell use a quoted heredoc, `<<'EOF'`, so `$` and quotes survive). Unknown keys fail.
  - `create`: `kind`, `topics`, `title`, `body` (required); `when`, `sources`, `id`.
  - `update`: `title`, `topics`, `add_topics`, `remove_topics`, `kind`, `when`, `sources`, `add_sources`, `body`, `append`, `expected_updated`.
  - `kind`: `event`, `decision`, `action`, `feedback`, `check`, `note`, `commitment`, `rule`.

```sh
thoth-mem create --json <<'EOF'
{"kind": "decision", "topics": ["gear/desk-setup", "finance/budget"], "title": "Pick desk mat under $75", "sources": ["https://example.com/desk-mat"], "body": "Chose wool felt; budget cap $75."}
EOF
thoth-mem update <id> --json <<'EOF'
{"append": "Ordered wool felt mat for $59.", "add_topics": ["orders/desk-mat"]}
EOF
```

- Check the returned JSON (`id`, `title`, `topics`, `body_preview`) for mangling.
- `delete <id>` archives; `restore <id>` brings it back. Never `--hard` unless the user asks for permanent deletion.
