import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import postgres from "postgres";

const profile = process.argv[2] ?? "local";
const batchSize = parseBatchSize(process.argv[3] ?? "1000");
const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? (await readDatabaseUrl(profile));
const sql = postgres(databaseUrl, { max: 2 });

try {
  await assertExpandedSchemaExists();

  const messagesUpdated = await backfillMessages();
  const filesUpdated = await backfillFiles();

  await verifyBackfill();
  console.log(`Message bigint backfill complete: ${messagesUpdated} messages and ${filesUpdated} file references updated.`);
} finally {
  await sql.end({ timeout: 5 });
}

async function backfillMessages() {
  let updatedTotal = 0;

  for (;;) {
    const rows = await sql.begin(
      (tx) => tx`
      with batch as (
        select id
        from thoth.messages
        where id_bigint is null
        order by created_at asc, id asc
        for update skip locked
        limit ${batchSize}
      )
      update thoth.messages as m
      set id_bigint = nextval('thoth.message_id_bigint_seq')
      from batch
      where m.id = batch.id
      returning m.id_bigint
    `,
    );

    updatedTotal += rows.length;
    console.log(`Backfilled message bigint ids: ${updatedTotal}`);

    if (rows.length < batchSize) {
      return updatedTotal;
    }
  }
}

async function backfillFiles() {
  let updatedTotal = 0;

  for (;;) {
    const rows = await sql.begin(
      (tx) => tx`
      with batch as (
        select f.id, m.id_bigint
        from thoth.files as f
        join thoth.messages as m on m.id = f.message_id
        where f.message_id_bigint is null
        order by f.created_at asc, f.id asc
        for update of f skip locked
        limit ${batchSize}
      )
      update thoth.files as f
      set message_id_bigint = batch.id_bigint
      from batch
      where f.id = batch.id
      returning f.id
    `,
    );

    updatedTotal += rows.length;
    console.log(`Backfilled file bigint references: ${updatedTotal}`);

    if (rows.length < batchSize) {
      return updatedTotal;
    }
  }
}

async function verifyBackfill() {
  const [invariants] = await sql`
    select
      (select count(*)::integer from thoth.messages where id_bigint is null) as message_null_count,
      (
        select count(*)::integer
        from (
          select id_bigint
          from thoth.messages
          group by id_bigint
          having count(*) > 1
        ) as duplicates
      ) as message_duplicate_count,
      (
        select count(*)::integer
        from thoth.files
        where message_id is not null
          and message_id_bigint is null
      ) as file_missing_bigint_count,
      (
        select count(*)::integer
        from thoth.files as f
        left join thoth.messages as m
          on m.id = f.message_id
         and m.id_bigint = f.message_id_bigint
        where f.message_id is not null
          and m.id is null
      ) as file_mismatch_count
  `;

  if (!invariants) {
    throw new Error("Backfill invariant query returned no row.");
  }

  const violations = Object.entries(invariants).filter(([, count]) => count !== 0);

  if (violations.length > 0) {
    throw new Error(`Backfill invariants failed: ${violations.map(([name, count]) => `${name}=${count}`).join(", ")}`);
  }
}

async function assertExpandedSchemaExists() {
  const [columns] = await sql`
    select
      to_regclass('thoth.messages') is not null as messages_exists,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'thoth'
          and table_name = 'messages'
          and column_name = 'id_bigint'
      ) as message_bigint_exists,
      exists (
        select 1
        from information_schema.columns
        where table_schema = 'thoth'
          and table_name = 'files'
          and column_name = 'message_id_bigint'
      ) as file_bigint_exists
  `;

  if (!columns?.messages_exists || !columns.message_bigint_exists || !columns.file_bigint_exists) {
    throw new Error("Run the expand migration before starting the bigint backfill.");
  }
}

async function readDatabaseUrl(selectedProfile) {
  if (selectedProfile !== "local" && selectedProfile !== "dev") {
    throw new Error(`Unsupported profile: ${selectedProfile}. Expected local or dev.`);
  }

  const credentialsPath = resolve(homedir(), ".thoth", `${selectedProfile}-secrets.env`);
  const contents = await readFile(credentialsPath, "utf8");
  const line = contents
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith("MIGRATION_DATABASE_URL="));

  if (!line) {
    throw new Error(`Missing MIGRATION_DATABASE_URL in ${credentialsPath}.`);
  }

  return unquote(line.slice("MIGRATION_DATABASE_URL=".length));
}

function parseBatchSize(value) {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 10000) {
    throw new Error("Batch size must be a positive integer no greater than 10000.");
  }

  return parsed;
}

function unquote(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}
