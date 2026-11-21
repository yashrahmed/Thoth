# Thoth

Minimal, reusable persistent-agent engine (v2) — clean separation between engine code (this repo, zero PII) and isolated personal/work instance repos.

- **Episodic memory CLI:** `thoth-mem` (`src/thoth_mem/cli.py`, run via `uv run --project <thoth> thoth-mem` from an instance folder)
- **To-do list CLI:** `todo-list` (`src/todo_list/cli.py`, run via `uv run --project <thoth> todo-list`) — one Markdown file per task in `<instance>/tasks/t-NNNN.md`; create/read/list/search/update/done/delete/restore, source-key dedupe, revision checks, CLI-owned `## Log`
- **Shared helpers:** `src/thoth_core/` (file lock, atomic write, strict JSON keys, secret scan, frontmatter)
- **Core skills** (`.agents/skills/`, symlinked into `.claude/skills/` and `.gemini/skills/`):
  - [`memory`](.agents/skills/memory/SKILL.md) — episodic CRUD, topic index, and date-range/keyword recall via `thoth-mem`
  - [`todo-list`](.agents/skills/todo-list/SKILL.md) — to-do list CRUD, actionable view, and source-key dedupe via `todo-list`
  - [`watch-video`](.agents/skills/watch-video/SKILL.md) — transcript + timestamped frame capture to local `work-artifacts/` + episode logging
  - [`create-new-thread`](.agents/skills/create-new-thread/SKILL.md) — top-level host thread creation with configurable prefix & model routing

> **Archive:** The previous Cloudflare Workers chat application (v1) is preserved at git tag [`v1-cloudflare-chat`](../../tree/v1-cloudflare-chat).
