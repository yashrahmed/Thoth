import postgres, { type Sql } from "postgres";

export type PostgresDatabase = Sql<Record<string, never>>;

export function createPostgresDatabase(databaseUrl: string): PostgresDatabase {
  return postgres(databaseUrl, { max: 1 });
}
