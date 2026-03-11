import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";

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

export interface LlmConfig {
  provider: string;
  model: string;
}

export interface ObjectStoreConfig {
  endpoint: string;
  bucket: string;
  region: string;
  service: string;
}

export interface ObjectStoreCredentialsConfig {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ThothConfig {
  llm: LlmConfig;
  objectStore: ObjectStoreConfig;
  ports: PortsConfig;
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
  const parsedConfig = parse(rawConfig);

  cachedConfig = parseConfig(parsedConfig);

  return cachedConfig;
}

export function getConvStoreDatabaseConfig(): ConvStoreDatabaseConfig {
  return {
    host: requireString(process.env.CONV_STORE_DB_HOST, "CONV_STORE_DB_HOST"),
    port: requireNumber(
      parseNumber(process.env.CONV_STORE_DB_PORT),
      "CONV_STORE_DB_PORT",
    ),
    database: requireString(
      process.env.CONV_STORE_DB_NAME,
      "CONV_STORE_DB_NAME",
    ),
    user: requireString(process.env.CONV_STORE_DB_USER, "CONV_STORE_DB_USER"),
    password: requireString(
      process.env.CONV_STORE_DB_PASSWORD,
      "CONV_STORE_DB_PASSWORD",
    ),
    ssl: requireBoolean(
      parseBoolean(process.env.CONV_STORE_DB_SSL),
      "CONV_STORE_DB_SSL",
    ),
  };
}

export function getLlmApiKey(): string {
  return requireString(process.env.OPENAI_API_KEY, "OPENAI_API_KEY");
}

export function getLlmConfig(): LlmConfig {
  return getThothConfig().llm;
}

export function getObjectStoreCredentialsConfig(): ObjectStoreCredentialsConfig {
  return {
    accessKeyId: requireString(
      process.env.R2_ACCESS_KEY_ID,
      "R2_ACCESS_KEY_ID",
    ),
    secretAccessKey: requireString(
      process.env.R2_SECRET_ACCESS_KEY,
      "R2_SECRET_ACCESS_KEY",
    ),
  };
}

export function getObjectStoreConfig(): ObjectStoreConfig {
  return getThothConfig().objectStore;
}

export function getPortsConfig(): PortsConfig {
  return getThothConfig().ports;
}

function parseConfig(value: unknown): ThothConfig {
  const config = requireObject(value, "config");
  const llm = requireObject(config.llm, "llm");
  const objectStore = requireObject(config.objectStore, "objectStore");
  const ports = requireObject(config.ports, "ports");

  return {
    llm: {
      provider:
        requireOptionalString(llm.provider, "llm.provider") ?? "openai",
      model: requireString(llm.model, "llm.model"),
    },
    objectStore: {
      endpoint: requireString(objectStore.endpoint, "objectStore.endpoint"),
      bucket: requireString(objectStore.bucket, "objectStore.bucket"),
      region: requireString(objectStore.region, "objectStore.region"),
      service: requireString(objectStore.service, "objectStore.service"),
    },
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
  };
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return undefined;
  }

  return parsed;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
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

function requireOptionalString(
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireString(value, fieldName);
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
