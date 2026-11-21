---
name: create-new-thread
description: Create a separate top-level chat or thread in the active host with optional instance title prefix, model, and reasoning settings. Use when asked to start a new thread or chat, not a delegated subagent.
---

# Create New Thread

Create a separate top-level conversation with the host's thread-creation tool, discovered at runtime. A subagent, background task, or fork doesn't count. Editing this skill doesn't request a thread.

## Inputs

- **Title:** given, or derived from the task; ask only if neither. If the instance's `AGENTS.md` defines a thread title prefix (e.g. `<Prefix> | <title>`), apply it without duplicating the prefix; otherwise use the plain title.
- **Prompt:** the requested work with enough context to act independently. Title only → a brief purpose and an instruction to wait for the user's task. Don't invent work or copy unrelated history.
- **Destination:** honor a requested host, provider, project, machine, or workspace (worktree or cloud per host rules). Otherwise use the active host, the current project from context or the project catalog, and the local workspace; go projectless for non-project work. Ask if unresolvable.

## Model and effort

Read the destination's capabilities first and use its advertised IDs and parameter names.

Defaults when no model is requested: honor any provider/model defaults specified in the instance's `AGENTS.md`, or fall back to the host's configured default (honor an explicit request for the host default).

Resolve shorthand family/version names against the live model catalog, skipping hidden or deprecated entries. Parse effort/thinking level separately and apply only when requested and supported.

Never guess IDs or silently switch provider, family, version, or effort. If a requested model, default, or effort is unavailable or ambiguous, ask before creating.

## Create and report

1. Create once with the title, prompt, destination, and settings, using fresh history unless a fork is requested. Use the host's idempotency key if offered. If the host can't create threads, say so without switching services.
2. Distinguish pending from ready. Never treat a pending ID as a thread ID or retry an ambiguous result; check the original first. Don't wait for dispatched work unless asked.
3. Report the title, state, and model/effort (or "configured default"), with the returned link verbatim. Use only rendering conventions the active host documents. Never claim success without a successful result.
