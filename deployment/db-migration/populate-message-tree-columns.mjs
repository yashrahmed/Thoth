#!/usr/bin/env bun

import { createRequire } from "node:module";

const require = createRequire(new URL("../../packages/conv-agent/package.json", import.meta.url));
const postgresModule = require("postgres");
const postgres = postgresModule.default ?? postgresModule;

const databaseUrl = process.env.DATABASE_URL;
const batchSize = parseBatchSize(process.env.BATCH_SIZE ?? "100");
const lockName = "thoth.populate_message_tree_columns";

if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1 });
let lockAcquired = false;

try {
  await sql`
    set search_path to flyway, thoth, public
  `;

  const [{ locked }] = await sql`
    select pg_try_advisory_lock(hashtext(${lockName})::bigint) as locked
  `;

  if (!locked) {
    throw new Error("Another message tree column population run is already active.");
  }
  lockAcquired = true;

  await assertNoOversizedLinearPaths(sql);

  let totalConversations = 0;
  let totalMessages = 0;
  let lastConversationId = null;

  for (;;) {
    const { conversation_count: conversationCount, updated_count: updatedCount, max_conversation_id: maxConversationId } = await populateBatch(sql, batchSize, lastConversationId);

    if (conversationCount === 0) {
      break;
    }

    totalConversations += conversationCount;
    totalMessages += updatedCount;
    lastConversationId = maxConversationId;

    console.log(`Populated ${updatedCount} message(s) across ${conversationCount} conversation(s).`);
  }

  const [{ incomplete_count: incompleteCount }] = await sql`
    select count(*)::integer as incomplete_count
    from thoth.messages message
    where
      message.path is null
      or message.child_count <> (
        select count(*)::integer
        from thoth.messages child_message
        where child_message.conversation_id = message.conversation_id
          and child_message.parent_message_id = message.id
      )
      or (
        message.parent_message_id is null
        and exists (
          select 1
          from thoth.messages previous_message
          where previous_message.conversation_id = message.conversation_id
            and previous_message.sequence_number < message.sequence_number
        )
      )
  `;

  console.log(`Done. Populated ${totalMessages} message(s) across ${totalConversations} batch conversation(s).`);
  console.log(`Remaining incomplete message(s): ${incompleteCount}.`);

  if (incompleteCount > 0) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unexpected message tree column population error.");
  process.exitCode = 1;
} finally {
  try {
    if (lockAcquired) {
      await sql`
        select pg_advisory_unlock(hashtext(${lockName})::bigint)
      `;
    }
  } finally {
    await sql.end();
  }
}

function parseBatchSize(rawValue) {
  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error("BATCH_SIZE must be a positive integer.");
    process.exit(1);
  }

  return parsed;
}

async function assertNoOversizedLinearPaths(sql) {
  const oversizedConversations = await sql`
    select
      conversation_id,
      count(*)::integer as message_count,
      (1 + greatest(count(*) - 1, 0) * 2)::integer as estimated_path_length
    from thoth.messages
    group by conversation_id
    having (1 + greatest(count(*) - 1, 0) * 2) > 65000
    order by estimated_path_length desc
    limit 10
  `;

  if (oversizedConversations.length === 0) {
    return;
  }

  const errorLines = ["Cannot populate ltree paths for conversations that are near the ltree length limit."];
  for (const conversation of oversizedConversations) {
    errorLines.push(`conversation_id=${conversation.conversation_id} message_count=${conversation.message_count} estimated_path_length=${conversation.estimated_path_length}`);
  }

  throw new Error(errorLines.join("\n"));
}

async function populateBatch(sql, batchSize, lastConversationId) {
  const [summary] = await sql`
    with recursive
      selected_conversations as (
        select message.conversation_id
        from thoth.messages message
        where ${lastConversationId}::text is null
          or message.conversation_id > ${lastConversationId}
        group by message.conversation_id
        order by message.conversation_id
        limit ${batchSize}
      ),
      ordered_messages as (
        select
          message.id,
          message.conversation_id,
          message.sequence_number,
          lag(message.id) over (
            partition by message.conversation_id
            order by message.sequence_number asc
          ) as parent_id
        from thoth.messages message
        join selected_conversations selected_conversation
          on selected_conversation.conversation_id = message.conversation_id
      ),
      message_chains as (
        select
          ordered_message.id,
          ordered_message.conversation_id,
          ordered_message.sequence_number,
          ordered_message.parent_id,
          '1'::ltree as path
        from ordered_messages ordered_message
        where ordered_message.parent_id is null

        union all

        select
          child_message.id,
          child_message.conversation_id,
          child_message.sequence_number,
          child_message.parent_id,
          parent_message.path || '1'::ltree as path
        from ordered_messages child_message
        join message_chains parent_message
          on parent_message.id = child_message.parent_id
      ),
      child_counts as (
        select
          parent_id as id,
          count(*)::integer as child_count
        from message_chains
        where parent_id is not null
        group by parent_id
      ),
      updated_messages as (
        update thoth.messages message
        set
          parent_message_id = message_chains.parent_id,
          path = message_chains.path,
          child_count = coalesce(child_counts.child_count, 0)
        from message_chains
        left join child_counts
          on child_counts.id = message_chains.id
        where message.id = message_chains.id
        returning message.id
      )
    select
      (select count(*)::integer from selected_conversations) as conversation_count,
      (select count(*)::integer from updated_messages) as updated_count,
      (select max(conversation_id) from selected_conversations) as max_conversation_id
  `;

  if (!summary) {
    throw new Error("Message tree column population query did not return a summary row.");
  }

  return summary;
}
