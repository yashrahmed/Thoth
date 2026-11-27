---
name: auto-commit
description: Batch and locally commit instance state files (configured in thoth.toml, defaulting to memory/episodes/, tasks/, health/, work-artifacts/) via auto-commit at the end of any turn that wrote them.
---

# Auto-Commit (`auto-commit`)

When a turn writes to allowed state paths, batch every touched path (both old and new paths on move/archive/restore) into **one local commit** right before replying:

```sh
uv run --project <thoth> auto-commit run -m "<concise summary>" <path1> [path2 ...]
```

## Contract (non-negotiable)

- **State paths only:** the CLI enforces the allowlist in `thoth.toml` (`[auto_commit].paths`), skips non-git dirs / in-progress merges or rebases / gitignored files, and leaves unrelated staged or dirty files untouched. Never run bare `git add -A` or `git add .`.
- **Local only:** never push unless the user explicitly asks.
- **Fail soft:** if `auto-commit` returns `ok: false` (e.g. `index.lock`), keep the written files and report the error.
