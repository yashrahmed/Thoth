# Configuring `thoth.toml` (`[threads]` & `[auto_commit]`)

Create `thoth.toml` in the instance root and verify with `uv run --project <thoth> thread-plan validate` and `auto-commit validate`.

```toml
[auto_commit]
paths = ["memory/episodes/", "tasks/", "health/", "work-artifacts/"]

[threads]
title_prefix = "Instance | "
workspace_default = "local"
default_model = { provider = "claudeAgent", model = "claude-opus-5-5", label = "Claude Opus 5.5" }
```

All sections and fields are optional:
- Without `[auto_commit]`, `auto-commit` defaults to `memory/episodes/`, `tasks/`, `health/`, `work-artifacts/`.
- Without `[threads]`, `thread-plan` uses no title prefix, `workspace_default = "local"`, and the host's configured default model.
