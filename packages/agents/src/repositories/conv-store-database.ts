interface ConvStoreDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

export function getConvStoreDatabaseConfig(): ConvStoreDatabaseConfig {
  return {
    host: requireEnv("CONV_STORE_DB_HOST"),
    port: Number(requireEnv("CONV_STORE_DB_PORT")),
    database: requireEnv("CONV_STORE_DB_NAME"),
    user: requireEnv("CONV_STORE_DB_USER"),
    password: requireEnv("CONV_STORE_DB_PASSWORD"),
    ssl: process.env.CONV_STORE_DB_SSL === "true",
  };
}

export type { ConvStoreDatabaseConfig };
