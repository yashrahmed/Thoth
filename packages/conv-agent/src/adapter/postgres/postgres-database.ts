import postgres, { type Sql } from "postgres";

export type PostgresDatabase = Sql<Record<string, never>>;

export function createPostgresDatabase(connectionString: string): PostgresDatabase {
  return postgres(connectionString, { max: 1 });
}
