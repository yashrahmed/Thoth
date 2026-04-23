import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "yaml";
import type { BlobStorageConfig } from "./blob-storage-config";

export type { BlobStorageConfig } from "./blob-storage-config";

export interface ProxyConfig {
  port: number;
}

export interface ConvAgentServiceConfig {
  port: number;
  database: {
    url: string;
  };
  blobStorage: BlobStorageConfig;
  llmDispatchQueue: {
    endpoint?: string;
    region: string;
    queueUrl: string;
  };
}

export interface ConvAgentCredentials {
  readonly blobStorage: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly llmDispatchQueue: {
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly database: {
    readonly username: string;
    readonly password: string;
  };
}

export type BlobStorageCredentials = ConvAgentCredentials["blobStorage"];

interface ConvAgentProfileConfig {
  proxy: ProxyConfig;
  convAgent: ConvAgentServiceConfig;
}

const PROFILE_PATTERN = /^[a-z0-9-]+$/;
const PROFILE_CONFIG_DIR = "packages/conv-agent/resources";

function getConvAgentProfileConfig(profile: string): ConvAgentProfileConfig {
  if (typeof profile !== "string" || profile.length === 0 || !PROFILE_PATTERN.test(profile)) {
    throw new Error(`profile must match ${PROFILE_PATTERN}; received ${JSON.stringify(profile)}.`);
  }

  const configFile = `${PROFILE_CONFIG_DIR}/${profile}.yaml`;
  const resolvedPath = resolveConfigFilePath(configFile);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Config file not found for profile "${profile}": ${resolvedPath}.`);
  }

  const rawConfig = readFileSync(resolvedPath, "utf8");
  const parsedConfig = parse(rawConfig);

  return parseConvAgentProfileConfig(parsedConfig);
}

export function resolveConfigFilePath(configFile: string, startDirectory = process.cwd()): string {
  if (isAbsolute(configFile)) {
    return configFile;
  }

  let currentDirectory = resolve(startDirectory);

  for (;;) {
    const candidatePath = join(currentDirectory, configFile);

    if (existsSync(candidatePath)) {
      return candidatePath;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return resolve(startDirectory, configFile);
    }

    currentDirectory = parentDirectory;
  }
}

export function getProxyConfig(profile: string): ProxyConfig {
  return getConvAgentProfileConfig(profile).proxy;
}

export function getConvAgentConfig(profile: string): ConvAgentServiceConfig {
  return getConvAgentProfileConfig(profile).convAgent;
}

export function readConvAgentCredentials(env: Record<string, string | undefined>): ConvAgentCredentials {
  return {
    blobStorage: readBlobStorageCredentials(env),
    llmDispatchQueue: {
      accessKeyId: requireEnv(env, "LLM_DISPATCH_QUEUE_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv(env, "LLM_DISPATCH_QUEUE_SECRET_ACCESS_KEY"),
    },
    database: {
      username: requireEnv(env, "DATABASE_USERNAME"),
      password: requireEnv(env, "DATABASE_PASSWORD"),
    },
  };
}

export function readBlobStorageCredentials(env: Record<string, string | undefined>): BlobStorageCredentials {
  return {
    accessKeyId: requireEnv(env, "BLOB_STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv(env, "BLOB_STORAGE_SECRET_ACCESS_KEY"),
  };
}

function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function parseConvAgentProfileConfig(value: unknown): ConvAgentProfileConfig {
  const config = requireObject(value, "config");
  const proxy = requireObject(config.proxy, "proxy");
  const convAgent = requireObject(config.convAgent, "convAgent");
  const convAgentDatabase = requireObject(convAgent.database, "convAgent.database");
  const convAgentBlobStorage = requireObject(convAgent.blobStorage, "convAgent.blobStorage");
  const convAgentLlmDispatchQueue = requireObject(convAgent.llmDispatchQueue, "convAgent.llmDispatchQueue");

  return {
    proxy: {
      port: requireNumber(proxy.port, "proxy.port"),
    },
    convAgent: {
      port: requireNumber(convAgent.port, "convAgent.port"),
      database: {
        url: requireString(convAgentDatabase.url, "convAgent.database.url"),
      },
      blobStorage: {
        endpoint: requireString(convAgentBlobStorage.endpoint, "convAgent.blobStorage.endpoint"),
        bucket: requireString(convAgentBlobStorage.bucket, "convAgent.blobStorage.bucket"),
        region: requireString(convAgentBlobStorage.region, "convAgent.blobStorage.region"),
        folder: requireString(convAgentBlobStorage.folder, "convAgent.blobStorage.folder"),
      },
      llmDispatchQueue: {
        endpoint: optionalString(convAgentLlmDispatchQueue.endpoint),
        region: requireString(convAgentLlmDispatchQueue.region, "convAgent.llmDispatchQueue.region"),
        queueUrl: requireString(convAgentLlmDispatchQueue.queueUrl, "convAgent.llmDispatchQueue.queueUrl"),
      },
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

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }

  return value;
}
