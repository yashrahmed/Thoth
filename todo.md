## Next Steps

### Making Thoth into an Omni Assistant

- An RTS-like chat UI that allows conversation branching and building like an evidence board.
  - Complete React tutorial.
  - Complete React Native tutorial.
  - Learn Three.js.
  - Design an RTS like UI showing conversation trees.
- User management, even though it is personal.
- Document vault and memories.
- Improve logging (Add structured logs).
- Model picker.
- Automatic research and knowledge synthesis plus continual learning.
- Deeplink content support.
- Utility API integration, for example with Groot API reverse engineering.
- Search and MCP integration.
- Add support for overlay mode and video/audio inputs.
- Completion streaming.
- Context compaction support.
- Thoth mobile prototype.
- Timestamps on tool messages?
- [Experimental] In-context RAG for long conversations to improve completion time.
- [Experimental] Talking forms.

## Performance Improvements

- Figure out a way around repeated signing, defaulting to base64?
- Cloudflare-hosted inference, Workers AI / AI Gateway:
  - Explore CF agents as an inference option to reduce completion time.

## DevOps

- GitHub Actions for building and deploying the app.

## Notes to Add Support for Conversation Branching

### Flow Changes

- `append-direct` needs `parentMessageId`.
  - Adds the message as a child of that parent.
  - Does not trigger completion. (`add-to-conv` has been removed.)
- `request-completion` accepts `parentMessageId` and `appendPosition`.
  - Schedules a completion whose reply attaches at that exact slot; duplicates are dropped.
  - Prompt context is the ancestor chain of the parent message.
- `get-messages-on-conv` needs a selected message, typically `leafMessageId`.
  - Loads the path from root to that selected or leaf message.
  - If an internal node is passed instead, it can render the partial path to that node.

### Data Model Changes

Before:

```sql
create table thoth.messages (
  id uuid primary key,
  conversation_id uuid not null references thoth.conversations(id),
  type text not null,
  sequence_number integer not null,
  content text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,

  unique (conversation_id, sequence_number)
);

constraint messages_sequence_number_positive
  check (sequence_number > 0);

constraint messages_conversation_sequence_unique
  unique (conversation_id, sequence_number);

create index messages_conversation_sequence_idx
  on thoth.messages (conversation_id, sequence_number asc);
```

After:

```sql
create extension if not exists ltree;

create table thoth.messages (
  id uuid primary key,
  conversation_id uuid not null references thoth.conversations(id),
  parent_message_id uuid null references thoth.messages(id),
  path ltree not null,
  type text not null,
  content text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,

  unique (conversation_id, path)
);

constraint messages_path_unique
  unique (conversation_id, path);

create index messages_parent_idx
  on thoth.messages (conversation_id, parent_message_id);

create index messages_path_gist_idx
  on thoth.messages using gist (path);

create index messages_created_idx
  on thoth.messages (conversation_id, created_at, id);
```

Old sequence-number constraints and indexes are removed.

### Non-Disruptive Migration Plan

Migration invariant:

```text
Any message missing tree columns must be present in the backfill control table.
The control table is drained only after parent tree data is available and the
message tree columns are populated.
```

- [x] Add the new nullable tree columns and supporting indexes.
- [x] Add new fields to represent the columns to table types and ensure that the API is backward compatible.
- [x] Cease operations
- [x] Write a script to backfill the values for the new columns and ensure that the API is backward compatible.
- [x] Remove sequence-number constraints and indexes.
- [x] `add-to-conv`
  - Accept a parent message id and the append position.
  - Append the new user message to that parent.
  - Populate the new tree columns on write.
  - Completion moved to the dedicated `request-completion` endpoint (branch-aware, position-idempotent); `add-to-conv` has been removed in favor of `append-direct`.
- [x] `append-direct`
  - Accept a parent message id and the append position.
  - Append the new message to that parent.
  - Populate the new tree columns on write.
  - If the parent tree data is unavailable, Error out the API.
  - Do not trigger completion.
- [x]`get-messages-on-conv`
  - Temporarily query the current leaf message and its children, pick the first leaf, and use it as the selected message. Error out if the leaf cannot be found.
  - Load the path from root to that selected message.
  - Page over the path results.
- [x] Ignore sequence number.
- [x] Add final constraints, including `path not null` and path uniqueness.
- [ ] Make UI changes.
- [x] Deploy changes to dev
- Switch external APIs to the final tree-aware inputs:
  - `get-messages-on-conv` requires a selected message, typically `leafMessageId`.
- Remove the `sequence_number` column.
- Delete the scheduled backfill procedure and control table.

## Reviews by Fable

Findings from a code review on 2026-06-09.

### Correctness

- [x] LLM completion context ignores the message tree. Fixed: completion is now requested explicitly via `POST /conversations/:id/request-completion` with `parentMessageId` + `appendPosition`; the prompt is built from the ancestor chain of the parent message (files scoped to that chain too), and duplicate/stale runs are dropped when the declared position is occupied. `validateTriggerMessage` is gone; the parent must be a user message.
- [ ] The web client computes `getAppendTarget` from the currently loaded message page; a partial page would produce a wrong parent. Derive the append target from the server's leaf response instead.

### Security

- [ ] No data ownership model: `thoth.conversations` has no owner column, so any allowed user or service token can read/modify/delete every conversation. Add `owner_identity` and scope queries by it (already on the roadmap as "User management"; cheaper to do before document vault / memories land).
- [ ] CORS reflects any `Origin` with `access-control-allow-credentials: true` (worker `index.ts`). With cookie-based Access auth this lets arbitrary sites make authenticated browser requests. Lock to an origin allowlist, or drop CORS since UI and API share an origin.
- [ ] Internal error messages leak to clients: 500 paths (worker fetch handler, Hono `onError`, `mapError`) return raw `error.message`, including DB errors. Log details, return generic messages for non-validation errors.
- [ ] Gemini API key is sent in the URL query string (`gemini-llm-adapter.ts`); URLs end up in logs/proxies. Use the `x-goog-api-key` header.

### Scalability / cost

- [ ] Every completion re-fetches all conversation files, base64-inlines them, and resends them with the full history — risks the Workers 128 MB memory limit and inflates token costs. Send only the active branch's files; consider the Gemini Files API for provider-side caching. (Related to the "repeated signing" perf item — defaulting to base64 inlining would make this worse, not better.)

### Testing

- [ ] Coverage is thin: one unit test file plus HTTP system tests. The trickiest logic (append-store path allocation, depth-window pagination, completion-context building) has no fast tests. AGENTS.md calls for repository tests against local Postgres; none exist.

### Docs drift

- [x] README "Append flow idempotency" section still describes `sequence_number` locking (dropped in V19); the `messages_path_unique` constraint now does provide duplicate-append protection. (Rewritten to describe explicit append positions and the request-completion contract.)
- [ ] AGENTS.md links to `styleguide.md`, which does not exist.
- [ ] Migration plan above lists "Remove the `sequence_number` column" as remaining, but V19 already did it.

### Code health

- [ ] `packages/web/src/App.tsx` is ~1,900 lines (API client, hooks, components, styles, formatters). Split into `api.ts`, hooks, and a `components/` directory before building the branching UI.
- [ ] Postgres adapters duplicate `mapRow`/`mapRows`/`toDate`/`getErrorMessage` helpers (~150 lines); extract shared row mappers.
- [ ] In `persistMessages`, the back-patch of `child_count` on the previous row is a smell — chain inserts know intermediate nodes have exactly one child, so set `child_count` at insert time.

### Strategic

- [ ] Move completion execution from `ctx.waitUntil` to Cloudflare Queues or Workflows to get retry/DLQ semantics; the `LLMCompletionRunService` port makes this a new adapter rather than a redesign. Prioritize right after the branch-aware completion fix.
