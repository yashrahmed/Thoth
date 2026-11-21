---
name: create-new-thread
description: Create a separate top-level chat or thread in the active host with optional instance title prefix, model, and reasoning settings. Use when asked to start a new thread or chat, not a delegated subagent.
---

# Create New Thread

Create a separate top-level conversation with the host's thread-creation tool, discovered at runtime. A subagent, background task, or fork doesn't count.

## Inputs

- **Title:** given, or derived from the task; ask only if neither. If the instance's instructions (e.g. `AGENTS.md`) define a title prefix (e.g. `<Prefix> | <title>`), apply it once; otherwise use the plain title.
- **Prompt:** the requested work with enough context to act independently. Title only → a brief purpose and an instruction to wait for the user's task. Don't invent work or copy unrelated history.
- **Destination:** honor a requested host, provider, project, machine, or workspace (worktree or cloud per host rules). Otherwise use the active host, the current project from context or the project catalog, and the local workspace; go projectless for non-project work. Ask if unresolvable.

## Model and effort

- Read the destination's capabilities first; use its advertised IDs and parameter names.
- No model requested → the instance's default if its instructions define one, else the host's configured default (an explicit request for the host default wins).
- Resolve shorthand names against the live catalog, skipping hidden/deprecated entries. Apply effort only when requested and supported.
- Never guess IDs or silently switch provider, family, version, or effort; if anything is unavailable or ambiguous, ask before creating.

## Create and report

1. Create once with the title, prompt, destination, and settings, using fresh history unless a fork is requested. Use the host's idempotency key if offered. If the host can't create threads, say so without switching services.
2. Distinguish pending from ready. Never treat a pending ID as a thread ID or retry an ambiguous result; check the original first. Don't wait for dispatched work unless asked.
3. Report the title, state, and model/effort (or "configured default"), with the returned link verbatim. Use only rendering conventions the active host documents. Never claim success without a successful result.
