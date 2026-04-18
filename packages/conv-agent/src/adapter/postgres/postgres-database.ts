import postgres, { type Sql } from "postgres";

export type PostgresDatabase = Sql<Record<string, never>>;

export function createPostgresDatabase(
  databaseUrl: string,
  credentials: { username: string; password: string },
): PostgresDatabase {
  return postgres(databaseUrl, {
    max: 1,
    username: credentials.username,
    password: credentials.password,
  });
}
