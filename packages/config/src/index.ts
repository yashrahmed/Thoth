import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";

export interface ProxyConfig {
  port: number;
}

export interface ConvAgentConfig {
  port: number;
  databaseUrl: string;
  blobStorage: {
    endpoint: string;
    bucket: string;
    region: string;
    folder: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

export interface KbCurateAgentConfig {
  port: number;
}

export interface PlanningAgentConfig {
  port: number;
}

interface ThothConfig {
  proxy: ProxyConfig;
  convAgent: ConvAgentConfig;
  kbCurateAgent: KbCurateAgentConfig;
  planningAgent: PlanningAgentConfig;
}

let cachedConfig: ThothConfig | null = null;

function getThothConfig(): ThothConfig {
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

  cachedConfig = parseConfig(parsedConfig, loadBlobStorageCredentials(dirname(resolvedPath)));

  return cachedConfig;
}

export function getProxyConfig(): ProxyConfig {
  return getThothConfig().proxy;
}

export function getConvAgentConfig(): ConvAgentConfig {
  return getThothConfig().convAgent;
}

export function getKbCurateAgentConfig(): KbCurateAgentConfig {
  return getThothConfig().kbCurateAgent;
}

export function getPlanningAgentConfig(): PlanningAgentConfig {
  return getThothConfig().planningAgent;
}

function parseConfig(value: unknown, blobStorageCredentials: BlobStorageCredentials): ThothConfig {
  const config = requireObject(value, "config");
  const proxy = requireObject(config.proxy, "proxy");
  const convAgent = requireObject(config.convAgent, "convAgent");
  const kbCurateAgent = requireObject(config.kbCurateAgent, "kbCurateAgent");
  const planningAgent = requireObject(config.planningAgent, "planningAgent");
  const convAgentBlobStorage = requireObject(convAgent.blobStorage, "convAgent.blobStorage");

  return {
    proxy: {
      port: requireNumber(proxy.port, "proxy.port"),
    },
    convAgent: {
      port: requireNumber(convAgent.port, "convAgent.port"),
      databaseUrl: requireString(convAgent.databaseUrl, "convAgent.databaseUrl"),
      blobStorage: {
        endpoint: requireString(convAgentBlobStorage.endpoint, "convAgent.blobStorage.endpoint"),
        bucket: requireString(convAgentBlobStorage.bucket, "convAgent.blobStorage.bucket"),
        region: requireString(convAgentBlobStorage.region, "convAgent.blobStorage.region"),
        folder: requireString(convAgentBlobStorage.folder, "convAgent.blobStorage.folder"),
        accessKeyId: requireString(convAgentBlobStorage.accessKeyId ?? blobStorageCredentials.accessKeyId, "convAgent.blobStorage.accessKeyId"),
        secretAccessKey: requireString(convAgentBlobStorage.secretAccessKey ?? blobStorageCredentials.secretAccessKey, "convAgent.blobStorage.secretAccessKey"),
      },
    },
    kbCurateAgent: {
      port: requireNumber(kbCurateAgent.port, "kbCurateAgent.port"),
    },
    planningAgent: {
      port: requireNumber(planningAgent.port, "planningAgent.port"),
    },
  };
}

function requireObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${fieldName} must be a valid number.`);
  }

  return value;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value;
}

interface BlobStorageCredentials {
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
}

function loadBlobStorageCredentials(configDir: string): BlobStorageCredentials {
  const credentialsPath = join(configDir, "cloudflare-creds.yaml");

  if (!existsSync(credentialsPath)) {
    return {};
  }

  const parsedValue = parse(readFileSync(credentialsPath, "utf8"));
  const credentials = requireObject(parsedValue, "cloudflare-creds");

  return {
    accessKeyId: optionalString(credentials.R2_ACCESS_KEY_ID),
    secretAccessKey: optionalString(credentials.R2_SECRET_ACCESS_KEY),
  };
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value;
}
