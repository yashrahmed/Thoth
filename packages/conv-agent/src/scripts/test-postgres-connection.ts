import postgres from "postgres";

const connectionString = Bun.argv[2] ?? process.env.DATABASE_URL;

if (!connectionString) {
  console.error("Usage: bun run db:test:connection -- <postgres-connection-string>");
  console.error("Or set DATABASE_URL in the environment.");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

try {
  const rows = await sql<{
    current_user: string;
    current_database: string;
    current_schema: string | null;
    server_time: string;
  }[]>`
    select
      current_user,
      current_database(),
      current_schema(),
      now()::text as server_time
  `;

  const row = rows[0];

  if (!row) {
    console.error("Connection succeeded but the probe query returned no rows.");
    process.exitCode = 1;
  } else {
    console.log("Connection OK");
    console.log(`user: ${row.current_user}`);
    console.log(`database: ${row.current_database}`);
    console.log(`schema: ${row.current_schema ?? "(null)"}`);
    console.log(`server_time: ${row.server_time}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown database connection error.";
  console.error(`Connection failed: ${message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
