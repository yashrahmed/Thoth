# Message ID Migration Plan

This is a zero-downtime, expand-migrate-contract plan. It assumes a globally generated sequential PostgreSQL `bigint`, represented as a decimal string in JSON and TypeScript.

## Starting state

The current implementation has:

- `thoth.messages.id` as a `text` primary key generated from `gen_random_uuid()`.
- `thoth.files.message_id` as a nullable `text` foreign key to `messages.id`.
- Message and file domain models represent message IDs as `string`.
- `POST /conversations/:id/append-direct` returns the UUID as `id`.
- `GET /conversations/:id/chat` returns UUID message IDs.
- `POST /conversations/:id/request-completion` accepts an ordered `messageIds: string[]`.
- The UI treats IDs as strings and sends the loaded message IDs to the completion endpoint.

Relevant locations:

- `packages/conv-agent/resources/db/migrations/V7__recreate_messages_for_sdk_like_parts.sql`
- `packages/conv-agent/resources/db/migrations/V9__add_message_id_to_files.sql`
- `packages/conv-agent/src/adapter/inbound/conversation-http-handler.ts`
- `packages/conv-agent/src/adapter/common/row-mapper.ts`
- `packages/web/src/App.tsx`

## Migration invariants

These must hold throughout the rollout:

1. Existing backend versions continue working after the first database migration.
2. New backend versions accept both UUIDs and bigint IDs during transition.
3. Responses do not switch to bigint IDs until every UUID-only backend instance is gone.
4. Existing and newly created messages always receive both identifiers during transition.
5. File associations remain valid through both identifiers.
6. The UUID columns are not removed until no deployed code reads or writes them.
7. Bigints are transported as strings:

```json
{
  "id": "18442",
  "messageIds": ["18390", "18401", "18442"]
}
```

Do not expose them as JSON numbers, because the full PostgreSQL `bigint` range exceeds JavaScript's safe-integer range.

## Phase 1: Establish migration tests

Before changing the schema, add system tests covering:

- Appending a message and receiving its ID.
- Listing messages and using the returned IDs in a completion request.
- Completion selection order.
- Rejecting an ID belonging to another conversation.
- Loading files through their message association.
- Deleting conversations and cascading to messages/files.
- Concurrent message creation while a backfill runs.

Create a compatibility test matrix:

| Server behavior | UUID input | Bigint input | Output |
|---|---:|---:|---|
| Existing | Yes | No | UUID |
| Compatibility release | Yes | Yes | UUID initially |
| Cutover release | Yes | Yes | Bigint |
| Final release | Via alias | Yes | Bigint |

These tests become deployment gates.

## Phase 2: Expand the message schema

Add a new nullable column without touching the existing primary key:

```sql
alter table thoth.messages
  add column id_bigint bigint;
```

Create a sequence and immediately make it the default for new rows:

```sql
create sequence thoth.message_id_bigint_seq;

alter table thoth.messages
  alter column id_bigint
  set default nextval('thoth.message_id_bigint_seq');
```

Important ordering:

1. Add the nullable column.
2. Set its default.
3. Only then begin backfilling.

This ensures messages created by old backend instances during the backfill automatically receive bigint IDs.

Do not add `NOT NULL` or replace the primary key yet.

## Phase 3: Expand file references

Add a parallel bigint reference:

```sql
alter table thoth.files
  add column message_id_bigint bigint;
```

Create an index on it, preferably concurrently:

```sql
create index concurrently files_message_bigint_created_idx
  on thoth.files (message_id_bigint, created_at asc, id asc);
```

Add temporary synchronization logic at the database boundary:

- When old code inserts a file using UUID `message_id`, populate `message_id_bigint`.
- When compatibility code inserts using `message_id_bigint`, populate the UUID `message_id`.

A temporary database trigger is the safest mechanism because it also protects against old backend instances and operational scripts. The trigger must reject rows where the UUID and bigint refer to different messages.

## Phase 4: Backfill existing messages

Backfill `messages.id_bigint` in bounded batches:

```sql
update thoth.messages
set id_bigint = nextval('thoth.message_id_bigint_seq')
where id_bigint is null
-- bounded batch selection
;
```

Avoid one unbounded update if the table can be large. Each batch should commit independently.

After every batch, verify:

- No duplicate bigint IDs.
- The count of populated rows is increasing.
- Newly inserted messages are not left null.
- No excessive table locking or replication lag.

Completion condition:

```sql
select count(*)
from thoth.messages
where id_bigint is null;
```

must return zero.

## Phase 5: Backfill file references

Backfill through the UUID relationship:

```sql
update thoth.files as f
set message_id_bigint = m.id_bigint
from thoth.messages as m
where f.message_id = m.id
  and f.message_id_bigint is null;
```

Verify:

- Every file with a UUID message reference has the corresponding bigint reference.
- Both references point to the same message.
- Files whose `message_id` is legitimately null remain null.

Then add the new foreign key as `NOT VALID`, followed by a separate validation:

```sql
alter table thoth.files
  add constraint files_message_id_bigint_fk
  foreign key (message_id_bigint)
  references thoth.messages (id_bigint)
  on delete cascade
  not valid;

alter table thoth.files
  validate constraint files_message_id_bigint_fk;
```

Before this, `messages.id_bigint` needs a unique index or constraint.

## Phase 6: Harden the expanded schema

Once backfill verification succeeds:

- Add a unique index on `messages.id_bigint`, preferably concurrently.
- Set `messages.id_bigint` to `NOT NULL`.
- Attach the new file foreign key.
- Retain the UUID primary key and old foreign key.

At this point, every message has both a UUID ID and a bigint ID. Both old and new applications can operate safely.

## Phase 7: Deploy the compatibility backend

Deploy a backend release that understands both identifier formats but continues returning UUIDs initially.

Required changes:

- Treat external IDs as opaque strings at the HTTP/application boundary.
- Recognize an all-decimal string as a bigint ID.
- Recognize the existing UUID format as a legacy ID.
- Resolve both forms to the same message.
- Preserve the caller's explicit message order after resolution.
- Validate conversation ownership after resolution.
- Reject duplicates after canonicalization. For example, a UUID and bigint referring to the same message count as a duplicate.
- Read and write both file reference columns.
- Map PostgreSQL bigint values to strings.

The compatibility repository should select both columns:

```sql
select
  id,
  id_bigint,
  conversation_id,
  type,
  content,
  created_at,
  updated_at
from thoth.messages;
```

Keep the API response mode behind configuration:

```text
MESSAGE_ID_RESPONSE_MODE=uuid
```

This release must be deployed to every backend instance before changing that setting.

## Phase 8: Deploy the bigint-compatible UI

Keep the UI type as an opaque string:

```ts
type MessageId = string;
```

Do not convert it with `Number()`, `parseInt()`, or arithmetic.

The UI should:

- Accept either UUID strings or decimal strings from append/list responses.
- Preserve IDs exactly as received.
- Send them unchanged in `messageIds`.
- Use them unchanged as React keys.
- Avoid UUID-specific validation or formatting.

The current UI already does most of this because `ChatMessage.id` is a string.

Deploy and verify this UI while the backend still returns UUIDs.

## Phase 9: Complete the server fleet gate

Before emitting bigint IDs, prove that:

- No UUID-only backend instances remain.
- No old worker or scheduled process accesses the tables.
- Every active backend accepts a bigint completion request.
- Rollback targets point to the compatibility release, not the original UUID-only release.

This is the most important no-break deployment gate. If a bigint-emitting server coexists with a UUID-only server, a client could receive a bigint from one instance and get a 404 when sending it to another.

## Phase 10: Switch API responses to bigint IDs

Change:

```text
MESSAGE_ID_RESPONSE_MODE=bigint
```

The following responses now expose decimal bigint strings as `id`:

- `POST /conversations/:id/append-direct`
- `GET /conversations/:id/chat`

The completion endpoint continues accepting both formats:

```json
{
  "messageIds": ["18401", "18442"]
}
```

No endpoint path or JSON field name changes. The completion response itself needs no migration because it currently does not return message IDs.

Monitor:

- UUID versus bigint request counts.
- ID-resolution failures.
- Foreign-conversation errors.
- File lookup failures.
- Missing bigint columns.
- Completion 400/404 rates.
- Append and chat error rates.

Soak this state before removing anything.

## Phase 11: Preserve legacy UUID resolution

If "endpoints never break" includes old browser tabs, retries, bookmarks, or persisted client state, create an alias table before deleting the UUID column:

```sql
create table thoth.message_id_aliases (
  legacy_uuid text primary key,
  message_id bigint not null unique
    references thoth.messages (id_bigint)
    on delete cascade
);
```

Populate it from every message:

```sql
insert into thoth.message_id_aliases (legacy_uuid, message_id)
select id, id_bigint
from thoth.messages;
```

The compatibility backend can then continue accepting old UUID requests after the UUID column is removed.

This is logically necessary for indefinite compatibility. If every UUID value and mapping is deleted, an old UUID can no longer be resolved. If permanent legacy support is unnecessary, retain the alias table only for a defined maximum client/session lifetime and remove it later as an explicitly scheduled contract change.

## Phase 12: Make bigint canonical internally

Deploy another backend release that:

- Uses `id_bigint` as the canonical domain/application ID.
- Returns only bigint IDs.
- Performs all message and file operations through bigint IDs.
- Uses the alias table only at the inbound compatibility boundary.
- No longer reads or writes the UUID columns during normal operations.
- Keeps the temporary synchronization trigger functioning only for rollback safety.

Run this release long enough to demonstrate zero UUID-column reads or writes.

At this point, rollback remains possible to the earlier compatibility backend, but not to the original UUID-only backend.

## Phase 13: Contract the database schema

Only after the bigint-only release is universal:

1. Confirm there are no null or duplicate bigint message IDs.
2. Confirm all file bigint references are valid.
3. Confirm the alias table is complete, if retained.
4. Stop UUID dual-writing.
5. Remove the synchronization trigger.
6. Drop the old file UUID foreign key.
7. Drop the old file UUID index.
8. Drop `files.message_id`.
9. Promote the unique bigint index to the messages primary key.
10. Drop the old UUID primary key.
11. Drop the UUID default.
12. Drop `messages.id`.

Use a short metadata-only transaction for primary-key replacement and column removal. Configure a small lock timeout and retry the migration rather than allowing it to block production traffic for a long period.

Keep the physical new column named `id_bigint` during this rollout. Renaming it to `id` adds another schema/application compatibility boundary without changing API behavior. If the conventional name is important, perform that later through a stable persistence view or a separate carefully gated migration.

## Phase 14: Final cleanup

Remove transitional code:

- UUID response mode.
- UUID dual-write behavior.
- Transitional row fields.
- UUID-specific repository queries.
- Compatibility metrics that are no longer needed.
- Temporary migration scripts and triggers.

Keep UUID input resolution only if the alias table remains part of the supported API contract.

Update tests so the primary contract is:

```ts
type MessageId = string; // decimal representation of PostgreSQL bigint
```

Validation should require a positive decimal integer within the PostgreSQL signed bigint range.

## End state

### Database

- Messages use a sequential 8-byte bigint primary key.
- Files reference the bigint message key with `ON DELETE CASCADE`.
- UUID columns on `messages` and `files` are deleted.
- Optionally, UUID aliases remain in a cold compatibility table.
- No UUID is generated for new messages.

### API

- Existing endpoint paths and field names remain unchanged.
- Message IDs are returned as decimal strings.
- `messageIds` remains an explicit, ordered selection.
- Bigint IDs are validated against the route conversation.
- Legacy UUID inputs can continue working through aliases if required.

### UI

- Message IDs remain opaque strings.
- The UI receives, stores, selects, and sends bigint decimal strings.
- No JavaScript precision loss is possible.

The critical deployment sequence is:

```text
Expand DB
-> backfill
-> dual-ID backend
-> compatible UI
-> drain UUID-only servers
-> emit bigint IDs
-> switch internal reads/writes
-> preserve aliases
-> delete UUID columns
```

Reversing any of the first five deployment gates risks transient completion failures.
