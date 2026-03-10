import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";

export interface ConvStoreDatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

export interface PortsConfig {
  proxy: number;
  convAgent: number;
  kbCurateAgent: number;
  planningAgent: number;
}

export interface ThothConfig {
  LLM_API_KEY: string;
  ports: PortsConfig;
  convStore: {
    db: ConvStoreDatabaseConfig;
  };
}

let cachedConfig: ThothConfig | null = null;

export function getThothConfig(): ThothConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configFile = process.env.CONFIG_FILE;

  if (!configFile) {
    throw new Error("CONFIG_FILE is required.");
  }

  const resolvedPath = resolve(process.cwd(), configFile);
  const rawConfig = readFileSync(resolvedPath, "utf8");
  const parsedConfig = YAML.parse(rawConfig);

  cachedConfig = parseConfig(parsedConfig);

  return cachedConfig;
}

export function getConvStoreDatabaseConfig(): ConvStoreDatabaseConfig {
  return getThothConfig().convStore.db;
}

export function getLlmApiKey(): string {
  return getThothConfig().LLM_API_KEY;
}

export function getPortsConfig(): PortsConfig {
  return getThothConfig().ports;
}

function parseConfig(value: unknown): ThothConfig {
  const config = requireObject(value, "config");
  const ports = requireObject(config.ports, "ports");
  const convStore = requireObject(config.convStore, "convStore");
  const convStoreDb = requireObject(convStore.db, "convStore.db");

  return {
    LLM_API_KEY: requireString(config.LLM_API_KEY, "LLM_API_KEY"),
    ports: {
      proxy: requireNumber(ports.proxy, "ports.proxy"),
      convAgent: requireNumber(ports.convAgent, "ports.convAgent"),
      kbCurateAgent: requireNumber(
        ports.kbCurateAgent,
        "ports.kbCurateAgent",
      ),
      planningAgent: requireNumber(
        ports.planningAgent,
        "ports.planningAgent",
      ),
    },
    convStore: {
      db: {
        host: requireString(convStoreDb.host, "convStore.db.host"),
        port: requireNumber(convStoreDb.port, "convStore.db.port"),
        database: requireString(
          convStoreDb.database,
          "convStore.db.database",
        ),
        user: requireString(convStoreDb.user, "convStore.db.user"),
        password: requireString(
          convStoreDb.password,
          "convStore.db.password",
        ),
        ssl: requireBoolean(convStoreDb.ssl, "convStore.db.ssl"),
      },
    },
  };
}

function requireObject(
  value: unknown,
  fieldName: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${fieldName} must be a valid number.`);
  }

  return value;
}

function requireBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${fieldName} must be a boolean.`);
  }

  return value;
}
