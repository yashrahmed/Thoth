# Setting Up `harnesses.toml`

Create `harnesses.toml` in the instance root, then verify it with `uv run --project <thoth> harness-route validate`.

## Minimal Example

```toml
providers = ["codex", "claudeAgent", "antigravity"]
# Optional fallback for unlisted capabilities: "native_or_block" (default) | "block" | "<alias>"

[aliases]
sol    = { provider = "codex",       model = "gpt-6.2-sol", options = { reasoningEffort = "medium" } }
sonnet = { provider = "claudeAgent", model = "claude-sonnet-5-5" }

[routes.email]
primary = "sol"
fallback = "sonnet"            # "native" | "none" | alias | { provider = "...", model = "..." }
aliases = ["gmail", "mail"]    # optional lookup aliases
directions = ["read", "write"] # optional (default: both)
fallback_directions = ["read"] # optional (default: same as directions)
boundary = "Work account only"
read_gate = "explicit_request" # optional
write_gate = "explicit_approval_or_rule" # default for writes ("none" to disable)
write_rules = ["20261123-124416-d7ca"]   # optional memory rule IDs
write_note = "Send only if approval says send; otherwise show draft in chat."
```

## Optional Route Fields

- `tools`: list of tool prefixes/names (e.g. `["preview_*"]`).
- `when`: trigger condition for using the capability.
- `stay_native_if`: condition under which `--stay-native` keeps execution on the current harness.
- `note`, `read_note`, `write_note`, `fallback_note`: short binding notes returned by `harness-route resolve`.
- `read_rules`, `write_rules`: memory rule IDs required before reading or writing.
