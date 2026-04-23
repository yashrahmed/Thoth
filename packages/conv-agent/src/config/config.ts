import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parse } from "yaml";

export interface BlobStorageConfig {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly folder: string;
}

interface AccessKeyCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

interface DatabaseCredentials {
  username: string;
  password: string;
}

export interface ConvAgentDatabaseConfig {
  readonly url: string;
  credentials: DatabaseCredentials | null;
}

export interface ConvAgentBlobStorageConfig extends BlobStorageConfig {
  credentials: AccessKeyCredentials | null;
}

export interface ConvAgentLlmDispatchQueueConfig {
  readonly endpoint?: string;
  readonly region: string;
  readonly queueUrl?: string;
  readonly bootstrap?: {
    readonly createQueue?: boolean;
    readonly queueName?: string;
  };
  credentials: AccessKeyCredentials | null;
}

export class ConvAgentConfig {
  constructor(
    readonly port: number,
    readonly database: ConvAgentDatabaseConfig,
    readonly blobStorage: ConvAgentBlobStorageConfig,
    readonly llmDispatchQueue: ConvAgentLlmDispatchQueueConfig,
  ) {}

  populateCredentials(env: Record<string, string | undefined>): void {
    this.blobStorage.credentials = {
      accessKeyId: requireEnv(env, "BLOB_STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv(env, "BLOB_STORAGE_SECRET_ACCESS_KEY"),
    };
    this.llmDispatchQueue.credentials = {
      accessKeyId: requireEnv(env, "LLM_DISPATCH_QUEUE_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv(env, "LLM_DISPATCH_QUEUE_SECRET_ACCESS_KEY"),
    };
    this.database.credentials = {
      username: requireEnv(env, "DATABASE_USERNAME"),
      password: requireEnv(env, "DATABASE_PASSWORD"),
    };
  }
}

interface ConvAgentProfileConfig {
  proxy: {
    port: number;
  };
  convAgent: ConvAgentConfig;
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

export function getProxyPort(profile: string): number {
  return getConvAgentProfileConfig(profile).proxy.port;
}

export function getConvAgentConfig(profile: string): ConvAgentConfig {
  return getConvAgentProfileConfig(profile).convAgent;
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
    convAgent: new ConvAgentConfig(
      requireNumber(convAgent.port, "convAgent.port"),
      {
        credentials: null,
        url: requireString(convAgentDatabase.url, "convAgent.database.url"),
      },
      {
        bucket: requireString(convAgentBlobStorage.bucket, "convAgent.blobStorage.bucket"),
        credentials: null,
        endpoint: requireString(convAgentBlobStorage.endpoint, "convAgent.blobStorage.endpoint"),
        folder: requireString(convAgentBlobStorage.folder, "convAgent.blobStorage.folder"),
        region: requireString(convAgentBlobStorage.region, "convAgent.blobStorage.region"),
      },
      {
        credentials: null,
        endpoint: optionalString(convAgentLlmDispatchQueue.endpoint),
        queueUrl: requireString(convAgentLlmDispatchQueue.queueUrl, "convAgent.llmDispatchQueue.queueUrl"),
        region: requireString(convAgentLlmDispatchQueue.region, "convAgent.llmDispatchQueue.region"),
      },
    ),
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
