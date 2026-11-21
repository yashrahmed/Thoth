---
name: memory
description: Read, search, create, update, or archive episodic memories via the thoth-mem CLI. Use when recalling past events, dates, decisions, rules, or commitments, or when recording new durable facts and updates.
---

# Episodic Memory (`thoth-mem`)

Manage persistent episodic memories stored as **1 Markdown + YAML frontmatter file per episode** under `<root>/memory/episodes/YYYY-MM/YYYYMMDD-HHMMSS-<4hex>.md`.

**Hard rule:** Never hand-create or edit files under `memory/episodes/`. Perform every write through `thoth-mem` (uses an OS file lock, atomic writes, and secret scanning).

## Invocation

Set `--root <instance-dir>` (or `THOTH_ROOT`, or run from the instance root):

```sh
# If installed globally (`uv tool install --editable <Thoth>`):
thoth-mem --root <dir> <command> ...

# Or directly via uv:
uv run --directory <Thoth> thoth-mem --root <dir> <command> ...
```

## 1. Recall & Search (Read Path)

Start narrow so you don't dump the whole corpus into context:

1. **Discover existing topics first (compact <2 KB index):**
   ```sh
   thoth-mem topics
   thoth-mem topics --since 30d
   ```
2. **Filter by topic, tag, kind, or date range** (`--since` / `--until` accept `YYYY-MM-DD`, ISO-8601, or relative windows `24h`, `7d`, `2w`, `1m`):
   ```sh
   thoth-mem list --since 10d --until 5d              # "~a week ago"
   thoth-mem list --topic vehicles --full             # full chronological history of one topic
   thoth-mem list --tag rule --full                   # active behavioral rules/preferences
   thoth-mem list --tag commitment --full             # tracked commitments
   ```
3. **Keyword search (optionally scoped by date/topic/tag):**
   ```sh
   thoth-mem search "refund" --since 30d
   thoth-mem search "chair flat" --all-terms --topic home
   ```
4. **Read one episode by ID:**
   ```sh
   thoth-mem read <id>
   ```

### Recall rules
- **Reconcile chronology:** Topics evolve across multiple episodes. Always sort by `when` and report the **latest** state — later actions/reschedules supersede earlier ones, including older `open` commitment episodes.
- **Never fabricate:** If `search`/`list` finds nothing, state clearly that it is not recorded.
- **Cite episode IDs** when summarizing multi-step histories or key facts.

## 2. Capture & Mutate (Write Path)

### What to capture (and what to skip)
- **One episode = one dated occurrence** (a decision, case update, completed action, commitment, or explicit user rule/preference) — never per-message chatter and never an entire multi-month project in one file.
- **Grounded facts only:** Record what the user actually said or what actually happened; keep any assistant inference separated under a `## Assistant Note` heading.
- **Standing rules require explicit user intent** (`"always"`, `"from now on"`, `"stop doing X"`, `"remember"`). Tag rules with `"rule"`; tag commitments with `["commitment", "open"]`.
- **Skip:** Pure Q&A, routine noise, transient tool/setup errors (`"tool X is broken"`), guesses about user traits, and raw secrets/API keys/tokens (redact before saving).

### `create` vs `update`
- **New chronological development** (reschedule, reply, new decision) → **`create`** a new episode so the timeline stays append-only.
- **In-place correction or metadata change** (typo fix, missed source, closing a commitment via `remove_tags`/`add_tags`, short clarification) → **`update <id>`**. `update` keeps the original `when` timestamp and automatically stamps `updated`.

### Always use `--json <<'EOF'` for writes
Using a single-quoted heredoc prevents shell expansion from silently corrupting `$` amounts (like `$300`), quotes, or backticks:

```sh
# Create (check `thoth-mem topics` first and reuse an existing lowercase topic slug)
thoth-mem create --json <<'EOF'
{
  "kind": "decision",
  "topic": "home/office-chair-shopping",
  "title": "Decided to test flat-back ergonomic chairs under $300",
  "tags": ["home", "decision", "chair"],
  "sources": ["t3-thread://..."],
  "body": "Ruled out gaming-style bolsters because they make me contract my shoulders."
}
EOF

# Update an existing episode by ID (preserves 'when', stamps 'updated')
thoth-mem update <id> --json <<'EOF'
{
  "append": "Follow-up: check warehouse price and return policy before buying.",
  "add_tags": ["done"],
  "remove_tags": ["open"]
}
EOF
```

- Valid `kind` values: `event`, `decision`, `action`, `feedback`, `check`, `note`, `commitment`.
- Optional `"when"` overrides the timestamp (defaults to now in local timezone with full `HH:MM:SS`).
- **Verify write output:** Inspect the returned JSON (`id`, `title`, `tags`, `body_preview`, `path`) to confirm nothing was truncated or mangled.

### Archiving & restoring
```sh
thoth-mem delete <id>      # Soft-delete: moves to memory/episodes/.archive/
thoth-mem restore <id>     # Moves back to memory/episodes/YYYY-MM/
```
Never pass `--hard` unless the user explicitly asks for permanent deletion.
