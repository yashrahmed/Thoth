---
name: auto-commit
description: Batch and locally commit instance state files (memory/episodes/, tasks/, health/, work-artifacts/) at the end of any turn that wrote them. Use whenever a turn creates, updates, archives, restores, or deletes those files.
---

# Auto-Commit

When a turn writes to `memory/episodes/`, `tasks/`, `health/`, or `work-artifacts/`, batch every file touched in that turn into **one local commit** right before replying.

## Rules

- **Commit only your paths:** From the instance root, stage and commit **only** the exact paths this turn changed (both old and new paths on move/archive/restore):
  ```sh
  git add -A -- <paths...> && git commit -m "<concise summary>" -- <paths...>
  ```
  Never run `git add -A` or `git add .` without explicit paths; unrelated dirty or staged files stay untouched.
- **Local only:** Never push unless the user asks.
- **Skip cleanly:** Skip if the instance root isn't a git work tree (`git rev-parse --is-inside-work-tree`), a merge/rebase is in progress, or the touched paths are gitignored.
- **Fail soft:** If git fails (e.g. `index.lock` from another thread), keep the written files and report the error.
