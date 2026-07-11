# Message ID Migration Plan

This is a zero-downtime, expand-migrate-contract plan. It assumes a globally generated sequential PostgreSQL `bigint`, represented as a decimal string in JSON and TypeScript.

## Implementation status and dev rollout scope

All application, Worker, UI, and test code described by this plan has already been implemented. The descriptions of application behavior below are deployment acceptance criteria, not instructions to make more code changes.

For the dev rollout:

- Do not repeat or reimplement any backend, UI, mapping, validation, or test changes described below.
- Do not perform a separate UI deployment for this migration; the UI already treats message IDs as opaque strings.
- Application rollout gates require only deployment of the already-prepared Worker releases.
- Database migrations and the bounded backfill still run at their stated gates.
- Phase 15 remains excluded and requires a new, explicit user request.

Phase 15 is the only section that describes possible future application changes, and those changes are prohibited until that explicit request is made.

## Starting state

The pre-migration implementation had:

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

## Phase 1: Migration tests (completed; no code changes required)

The completed system-test coverage includes:

- Appending a message and receiving its ID.
- Listing messages and using the returned IDs in a completion request.
- Completion selection order.
- Rejecting an ID belonging to another conversation.
- Loading files through their message association.
- Deleting conversations and cascading to messages/files.
- Concurrent message creation while a backfill runs.

Use the completed compatibility matrix as a deployment gate:

| Server behavior | UUID input | Bigint input | Output |
|---|---:|---:|---|
| Existing | Yes | No | UUID |
| Compatibility release | Yes | Yes | UUID initially |
| Cutover release | Yes | Yes | Bigint |
| Final release | Via alias | Yes | Bigint |

No new test implementation is required for the dev rollout.

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

## Phase 7: Deploy the prepared compatibility Worker

Deploy the already-implemented Worker release that understands both identifier formats but continues returning UUIDs initially. No code changes are required.

Verify its already-implemented behavior:

- Treat external IDs as opaque strings at the HTTP/application boundary.
- Recognize an all-decimal string as a bigint ID.
- Recognize the existing UUID format as a legacy ID.
- Resolve both forms to the same message.
- Preserve the caller's explicit message order after resolution.
- Validate conversation ownership after resolution.
- Reject duplicates after canonicalization. For example, a UUID and bigint referring to the same message count as a duplicate.
- Read and write both file reference columns.
- Map PostgreSQL bigint values to strings.

This prepared release uses the UUID response mode:

```text
MESSAGE_ID_RESPONSE_MODE=uuid
```

Deploy this prepared Worker release to every backend instance before moving to the bigint-emitting Worker release.

## Phase 8: Confirm UI compatibility (completed; no UI deployment required)

The implemented UI keeps the ID type as an opaque string:

```ts
type MessageId = string;
```

It does not convert IDs with `Number()`, `parseInt()`, or arithmetic.

Verify the existing UI behavior:

- Accept either UUID strings or decimal strings from append/list responses.
- Preserve IDs exactly as received.
- Send them unchanged in `messageIds`.
- Use them unchanged as React keys.
- Avoid UUID-specific validation or formatting.

No UI code change or separate UI deployment is needed. Verify the existing deployed UI while the Worker still returns UUIDs.

## Phase 9: Complete the server fleet gate

Before emitting bigint IDs, prove that:

- No UUID-only backend instances remain.
- No old worker or scheduled process accesses the tables.
- Every active backend accepts a bigint completion request.
- Rollback targets point to the compatibility release, not the original UUID-only release.

This is the most important no-break deployment gate. If a bigint-emitting server coexists with a UUID-only server, a client could receive a bigint from one instance and get a 404 when sending it to another.

## Phase 10: Deploy the prepared bigint-response Worker

Deploy the already-implemented Worker release whose response mode is:

```text
MESSAGE_ID_RESPONSE_MODE=bigint
```

No code or configuration authoring is required. After the Worker deployment, the following responses expose decimal bigint strings as `id`:

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

## Phase 12: Deploy the prepared bigint-canonical Worker

Deploy the already-implemented Worker release that:

- Uses `id_bigint` as the canonical domain/application ID.
- Returns only bigint IDs.
- Performs all message and file operations through bigint IDs.
- Uses the alias table only at the inbound compatibility boundary.
- No longer reads or writes the UUID columns during normal operations.
- Keeps the temporary synchronization trigger functioning only for rollback safety.

No code changes are required. Run this Worker release long enough to demonstrate zero UUID-column reads or writes.

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

## Phase 14: Verify completed application cleanup

The prepared Worker release has already removed transitional application code. Verify that it contains no normal-path use of:

- UUID response mode.
- UUID dual-write behavior.
- Transitional row fields.
- UUID-specific repository queries.
- Compatibility metrics that are no longer needed.

Database migration tooling is not application code and remains available until the dev rollout has completed. The contract migration removes the temporary database triggers.

UUID input resolution remains only because the alias table is part of the supported API contract.

The completed tests use the primary contract:

```ts
type MessageId = string; // decimal representation of PostgreSQL bigint
```

Validation already requires a positive decimal integer within the PostgreSQL signed bigint range. No additional application or test changes are required during the normal dev rollout.

## Phase 15: Remove legacy UUID lookup support (explicit opt-in only)

This phase is **not part of the normal message ID migration**. Do not create, apply, schedule, or automatically include a migration that removes UUID aliases. Execute this phase only after the user makes a separate, explicit request to remove legacy UUID lookup support.

Until that explicit request is made:

- Keep `thoth.message_id_aliases` and its data.
- Keep UUID recognition at the inbound compatibility boundary.
- Keep repository resolution from `legacy_uuid` to the canonical bigint ID.
- Keep tests proving that historical UUID inputs still resolve.

After an explicit removal request, treat removal as a new expand-contract rollout rather than appending an automatically executable cleanup migration to the original sequence:

1. Confirm UUID request traffic has remained at zero for longer than the maximum supported browser session, retry, bookmark, and persisted-client lifetime.
2. Confirm no supported rollback release requires UUID lookup.
3. Explicitly acknowledge that any remaining client holding an old message UUID will receive a validation or not-found response after this change.
4. Change inbound validation to accept only positive decimal bigint strings.
5. Remove the repository alias lookup and deploy that backend release everywhere while leaving the alias table intact.
6. Soak and verify bigint-only completion requests, explicit ordering, conversation ownership checks, file lookup, and deletion behavior.
7. Only then create and apply a new database migration that drops `thoth.message_id_aliases`.
8. Remove legacy UUID compatibility tests and metrics after the database migration succeeds.

The database migration for this phase must not exist in the normal migration chain ahead of the explicit request. This prevents a routine Flyway run from irreversibly removing compatibility data.

## End state

### Database

- Messages use a sequential 8-byte bigint primary key.
- Files reference the bigint message key with `ON DELETE CASCADE`.
- UUID columns on `messages` and `files` are deleted.
- The normal migration retains UUID aliases in a cold compatibility table.
- The alias table is removed only by the separately requested Phase 15.
- No UUID is generated for new messages.

### API

- Existing endpoint paths and field names remain unchanged.
- Message IDs are returned as decimal strings.
- `messageIds` remains an explicit, ordered selection.
- Bigint IDs are validated against the route conversation.
- Legacy UUID inputs continue working through aliases after the normal migration.
- Bigint-only input is enforced only after the separately requested Phase 15.

### UI

- Message IDs remain opaque strings.
- The UI receives, stores, selects, and sends bigint decimal strings.
- No JavaScript precision loss is possible.

The critical deployment sequence is:

```text
Expand DB
-> backfill
-> deploy prepared dual-ID Worker
-> verify existing UI compatibility (no UI deployment)
-> drain UUID-only Workers
-> deploy prepared bigint-response Worker
-> deploy prepared bigint-canonical Worker
-> preserve aliases
-> delete UUID columns
-> STOP: normal migration complete
```

Reversing any of the first five deployment gates risks transient completion failures.

All normal application transitions above are Worker deployments of completed code. They do not require new code changes or a web/UI deployment.

Phase 15 is a separate, explicit opt-in operation and must never run as part of this sequence without a new user request.
