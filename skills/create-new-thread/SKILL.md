---
name: create-new-thread
description: Create a separate top-level chat or thread in the active host with instance defaults from thoth.toml via thread-plan. Use when asked to start a new thread or chat, not a delegated subagent.
---

# Create New Thread (`thread-plan`)

Prepare the normalized title, model selection, starter prompt framing, and `client_request_id` from `thoth.toml`:

```sh
uv run --project <thoth> thread-plan prepare [--title "..."] [--task "..."] [--model "..."] [--effort "..."] [--host-default] [--workspace "..."]
```

If `action` is `ask`, ask the user for a title or task before creating. Then launch one separate top-level thread via the active host's thread-creation tool (a subagent, background task, or fork doesn't count unless `--fork` was requested).

## Contract (non-negotiable)

- **Live catalog check:** read the destination's live capabilities first; resolve shorthand names against advertised, non-deprecated IDs and parameter names. Apply effort only when requested and supported. Never guess IDs or silently switch provider, family, version, or effort — ask if unavailable or ambiguous.
- **Create once, safely:** pass the returned `client_request_id`, fresh history (unless forked), and resolved destination (active host, current project or projectless; ask if unresolvable). If the host cannot create threads, say so without switching services.
- **Pending vs. ready:** never treat a pending ID as a thread ID or blindly retry an ambiguous result (check the original first). Don't wait for dispatched work unless asked.
- **Report:** state the title, status, model/effort (or "configured default"), and the returned link verbatim using only the active host's documented rendering. Never claim success without a successful result.

Instance defaults schema: `references/setup.md`.
