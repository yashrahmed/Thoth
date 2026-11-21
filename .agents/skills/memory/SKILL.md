---
name: memory
description: Read, search, create, update, or archive episodic memories via the thoth-mem CLI. Use when recalling past events, dates, decisions, rules, or commitments, or when recording new durable facts and updates.
---

# Episodic Memory (`thoth-mem`)

Manage persistent episodic memories stored as **1 Markdown + YAML frontmatter file per episode** under `<root>/memory/episodes/YYYY-MM/YYYYMMDD-HHMMSS-<4hex>.md`.

**Hard rule:** Never hand-create or edit files under `memory/episodes/`. Perform every write through `thoth-mem` (uses an OS file lock, atomic writes, strict JSON key validation, and secret scanning).

## Invocation

Set `--root <instance-dir>` (or `THOTH_ROOT`, or run from the instance root). If `thoth-mem` is not installed globally on `PATH` (`uv tool install --editable <Thoth>`), invoke it directly with `uv run --directory <Thoth> thoth-mem --root <dir> ...`.

## 1. Recall & Search (Read Path)

Start narrow so you don't dump the whole corpus into context:

1. **Discover existing topics first:**
   ```sh
   thoth-mem topics
   thoth-mem topics --since 30d
   ```
2. **Filter by topic/prefix, repeatable tags (AND), kind, or date range** (`--since` and `--until` are inclusive; accept `YYYY-MM-DD`, ISO-8601, or relative windows `24h`, `7d`, `2w`, `1mo`):
   ```sh
   thoth-mem list --since 10d --until 5d              # "~a week ago"
   thoth-mem list --topic projects/alpha --full       # exact topic or prefix history
   thoth-mem list --tag rule --full                   # active behavioral rules/preferences
   thoth-mem list --tag commitment --tag open --full  # open commitments only
   ```
3. **Keyword or exact URL/ID search** (searches `topic`, `title`, `tags`, `sources`, and `body`; URLs/times/IDs match literally, or force `--exact`):
   ```sh
   thoth-mem search "refund" --since 30d
   thoth-mem search "https://example.com/item/123"    # dedupe by source URL
   ```
4. **Read one episode by ID:**
   ```sh
   thoth-mem read <id>
   ```

### Recall rules
- **Reconcile chronology:** Topics evolve across multiple episodes. Always check `when` timestamps and report the **latest** state — later actions/reschedules supersede earlier ones.
- **Never fabricate:** If `search`/`list` finds nothing, state clearly that it is not recorded.
- **Cite episode IDs** when summarizing multi-step histories or key facts.

## 2. Capture & Mutate (Write Path)

### What to capture (and what to skip)
- **One episode = one dated occurrence** (a decision, case update, completed action, commitment, or explicit user rule/preference) — never per-message chatter and never an entire multi-month project in one file.
- **Grounded facts only:** Record what the user actually said or what actually happened; keep any assistant inference separated under a `## Assistant Note` heading.
- **Standing rules require explicit user intent** (`"always"`, `"from now on"`, `"stop doing X"`, `"remember"`). Tag rules with `"rule"`; tag open commitments with `["commitment", "open"]`.
- **Skip:** Pure Q&A, routine noise, transient tool/setup errors (`"tool X is broken"`), guesses about user traits, and raw secrets/API keys/tokens (redact before saving).

### `create` vs `update`
- **New chronological development** (reschedule, reply, new decision) → **`create`** a new episode so the timeline stays append-only.
- **In-place correction or metadata change** (typo fix, missed source, closing a commitment, short clarification) → **`update <id>`**. `update` keeps the original `when` timestamp and automatically stamps `updated`.

### Always use `--json <<'EOF'` for writes
Using a single-quoted heredoc prevents shell expansion from silently corrupting `$` amounts, quotes, or backticks. Unknown JSON keys are rejected loudly.

- **`create --json` allowed keys:** `kind`, `topic`, `title`, `body` (required); `when`, `tags`, `sources`, `id` (optional).
- **`update --json` allowed keys:** `title`, `topic`, `kind`, `when`, `tags`, `add_tags`, `remove_tags`, `sources`, `add_sources`, `body`, `append`, `expected_updated`.

```sh
# Create (check `thoth-mem topics` first and reuse an existing lowercase topic slug)
thoth-mem create --json <<'EOF'
{
  "kind": "decision",
  "topic": "gear/desk-setup",
  "title": "Pick minimalist desk mat under $75",
  "tags": ["gear", "decision"],
  "sources": ["https://example.com/desk-mat"],
  "body": "Chose wool felt over synthetic leather; budget cap is $75."
}
EOF

# Update an existing episode by ID (preserves 'when', stamps 'updated')
thoth-mem update <id> --json <<'EOF'
{
  "append": "Ordered wool felt mat for $59.",
  "add_tags": ["done"],
  "remove_tags": ["open"]
}
EOF
```

- Valid `kind` values: `event`, `decision`, `action`, `feedback`, `check`, `note`, `commitment`.
- **Verify write output:** Inspect the returned JSON (`id`, `title`, `tags`, `body_preview`, `path`) to confirm nothing was truncated or mangled.

### Archiving & restoring
```sh
thoth-mem delete <id>      # Soft-delete: moves to memory/episodes/.archive/
thoth-mem restore <id>     # Moves back to memory/episodes/YYYY-MM/
```
Never pass `--hard` unless the user explicitly asks for permanent deletion.
