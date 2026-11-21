# Thoth

Minimal, reusable persistent-agent engine (v2) — clean separation between engine code (this repo, zero PII) and isolated personal/work instance repos.

- **CLIs:** `thoth-mem` (`src/thoth_mem/`) and `todo-list` (`src/todo_list/`), sharing helpers in `src/thoth_core/`. Each is documented in the skill that uses it.
- **Skills** (`skills/<name>/SKILL.md`), a plain library. Each instance links the skills it uses into its own harness folders (e.g. `.agents/skills/`, `.claude/skills/`, `.gemini/skills/`):
  - [`memory`](skills/memory/SKILL.md) — episodic CRUD, topic index, and date-range/keyword recall via `thoth-mem`
  - [`todo-list`](skills/todo-list/SKILL.md) — to-do list CRUD, actionable view, and source-key dedupe via `todo-list`
  - [`what-do-i-do`](skills/what-do-i-do/SKILL.md) — refresh the to-do list from an instance's allowlisted channels (`intake/channels.toml`) and show what needs action
  - [`log-workout`](skills/log-workout/SKILL.md) — log and count workout sessions in an instance's Google Doc log, for trainer billing
  - [`watch-video`](skills/watch-video/SKILL.md) — transcript + timestamped frame capture to local `work-artifacts/` + episode logging
  - [`create-new-thread`](skills/create-new-thread/SKILL.md) — top-level host thread creation with configurable prefix & model routing

> **Archive:** The previous Cloudflare Workers chat application (v1) is preserved at git tag [`v1-cloudflare-chat`](../../tree/v1-cloudflare-chat).
