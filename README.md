# Thoth

Minimal, reusable persistent-agent engine (v2) — clean separation between engine code (this repo, zero PII) and isolated personal/work instance repos.

- **Episodic memory CLI:** `thoth-mem` (`src/thoth_mem/cli.py`, run via `uv run thoth-mem`)
- **Memory skill:** [`.agents/skills/memory/SKILL.md`](.agents/skills/memory/SKILL.md) (symlinked into `.claude/skills/` and `.gemini/skills/`)

> **Archive:** The previous Cloudflare Workers chat application (v1) is preserved at git tag [`v1-cloudflare-chat`](../../tree/v1-cloudflare-chat).
