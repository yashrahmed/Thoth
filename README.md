# Thoth

Minimal, reusable persistent-agent engine (v2) — clean separation between engine code (this repo, zero PII) and isolated personal/work instance repos.

- **CLIs:** `thoth-mem` (`src/thoth_mem/`) and `todo-list` (`src/todo_list/`), sharing helpers in `src/thoth_core/`. Each is documented in the skill that uses it.
- **Skills** (`skills/<name>/SKILL.md`), a plain library. Each instance links the skills it uses into its own harness folders (e.g. `.agents/skills/`, `.claude/skills/`, `.gemini/skills/`):
  - [`memory`](skills/memory/SKILL.md) — episodic CRUD, topic index, and date-range/keyword recall via `thoth-mem`
  - [`todo-list`](skills/todo-list/SKILL.md) — to-do list CRUD, actionable view, and source-key dedupe via `todo-list`
  - [`look-around`](skills/look-around/SKILL.md) — objective HTML snapshot of activity in an instance's allowlisted channels (`intake/channels.toml`) since the last look
  - [`what-do-i-do`](skills/what-do-i-do/SKILL.md) — deprecated, marked for deletion; shows open tasks only
  - [`log-workout`](skills/log-workout/SKILL.md) — log and count workout sessions in an instance's Google Doc log, for trainer billing
  - [`watch-video`](skills/watch-video/SKILL.md) — transcript + timestamped frame capture to local `work-artifacts/` + episode logging
  - [`prune-video-captures`](skills/prune-video-captures/SKILL.md) — delete finished captures' screenshots, keep transcripts, leave a tombstone + episode
  - [`auto-commit`](skills/auto-commit/SKILL.md) — batch and locally commit touched instance state (`memory/episodes/`, `tasks/`, `work-artifacts/`) at turn end
  - [`create-new-thread`](skills/create-new-thread/SKILL.md) — top-level host thread creation with configurable prefix & model routing

> **Archive:** The previous Cloudflare Workers chat application (v1) is preserved at git tag [`v1-cloudflare-chat`](../../tree/v1-cloudflare-chat).
