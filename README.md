# Thoth

Minimal, reusable persistent-agent engine (v2) — clean separation between engine code (this repo, zero PII) and isolated personal/work instance repos.

- **CLIs:** `thoth-mem` (`src/thoth_mem/`), `todo-list` (`src/todo_list/`), `health-track` (`src/health_track/`), `harness-route` (`src/harness_route/`), `auto-commit` (`src/auto_commit/`), and `thread-plan` (`src/thread_plan/`), sharing helpers in `src/thoth_core/`. Each is documented in the skill that uses it.
- **Skills** (`skills/<name>/SKILL.md`), a plain library. Each instance links the skills it uses into its own harness folders (e.g. `.agents/skills/`, `.claude/skills/`, `.gemini/skills/`):
  - [`memory`](skills/memory/SKILL.md) — episodic CRUD, topic index, and date-range/keyword recall via `thoth-mem`
  - [`todo-list`](skills/todo-list/SKILL.md) — to-do list CRUD, actionable view, and source-key dedupe via `todo-list`
  - [`health-tracker`](skills/health-tracker/SKILL.md) — typed local health & workout log (meals, weight/waist, CPAP, meds, trainer/solo workouts, slips), staples catalog, weekly HTML check-in, and separate two-way Google Sheet sync via `health-track`
  - [`harness-selection`](skills/harness-selection/SKILL.md) — declarative primary/fallback harness routing, gates, and fallback telemetry from an instance's `harnesses.toml` via `harness-route`
  - [`watch-video`](skills/watch-video/SKILL.md) — transcript + timestamped frame capture to local `work-artifacts/` + episode logging
  - [`prune-video-captures`](skills/prune-video-captures/SKILL.md) — delete finished captures' screenshots, keep transcripts, leave a tombstone + episode
  - [`auto-commit`](skills/auto-commit/SKILL.md) — path-scoped local commits of touched instance state (`thoth.toml` `[auto_commit]`) via `auto-commit`
  - [`create-new-thread`](skills/create-new-thread/SKILL.md) — declarative top-level thread creation planning (`thoth.toml` `[threads]`) via `thread-plan`

> **Archive:** The previous Cloudflare Workers chat application (v1) is preserved at git tag [`v1-cloudflare-chat`](../../tree/v1-cloudflare-chat).
