# Thoth

Minimal, reusable persistent-agent engine (v2) — clean separation between engine code (this repo, zero PII) and isolated personal/work instance repos.

- **CLIs:** `thoth-mem` (`src/thoth_mem/`) and `todo-list` (`src/todo_list/`), sharing helpers in `src/thoth_core/`. Each is documented in the skill that uses it.
- **Core skills** (`.agents/skills/`, symlinked into `.claude/skills/` and `.gemini/skills/`):
  - [`memory`](.agents/skills/memory/SKILL.md) — episodic CRUD, topic index, and date-range/keyword recall via `thoth-mem`
  - [`todo-list`](.agents/skills/todo-list/SKILL.md) — to-do list CRUD, actionable view, and source-key dedupe via `todo-list`
  - [`watch-video`](.agents/skills/watch-video/SKILL.md) — transcript + timestamped frame capture to local `work-artifacts/` + episode logging
  - [`create-new-thread`](.agents/skills/create-new-thread/SKILL.md) — top-level host thread creation with configurable prefix & model routing

> **Archive:** The previous Cloudflare Workers chat application (v1) is preserved at git tag [`v1-cloudflare-chat`](../../tree/v1-cloudflare-chat).
