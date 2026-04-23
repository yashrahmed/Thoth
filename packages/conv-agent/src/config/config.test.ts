import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { ConvAgentConfig, getConvAgentConfig, resolveConfigFilePath } from "./config";

describe("resolveConfigFilePath", () => {
  test("returns an absolute path unchanged", () => {
    const absolutePath = "/tmp/thoth-config.yaml";

    expect(resolveConfigFilePath(absolutePath, "/tmp")).toBe(absolutePath);
  });

  test("finds a relative config path in a parent directory", () => {
    const rootDirectory = mkdtempSync(join(tmpdir(), "thoth-config-"));
    const nestedDirectory = join(rootDirectory, "packages", "conv-agent");
    const configPath = join(rootDirectory, "packages", "conv-agent", "resources", "local.yaml");

    mkdirSync(join(rootDirectory, "packages", "conv-agent", "resources"), { recursive: true });
    mkdirSync(nestedDirectory, { recursive: true });
    writeFileSync(configPath, "proxy:\n  port: 3000\n");

    try {
      expect(resolveConfigFilePath("packages/conv-agent/resources/local.yaml", nestedDirectory)).toBe(configPath);
    } finally {
      rmSync(rootDirectory, { force: true, recursive: true });
    }
  });
});

describe("ConvAgentConfig credentials", () => {
  const REQUIRED_KEYS = [
    "BLOB_STORAGE_ACCESS_KEY_ID",
    "BLOB_STORAGE_SECRET_ACCESS_KEY",
    "LLM_DISPATCH_QUEUE_ACCESS_KEY_ID",
    "LLM_DISPATCH_QUEUE_SECRET_ACCESS_KEY",
    "DATABASE_USERNAME",
    "DATABASE_PASSWORD",
  ] as const;

  function buildEnv(): Record<string, string | undefined> {
    return {
      BLOB_STORAGE_ACCESS_KEY_ID: "blob-id",
      BLOB_STORAGE_SECRET_ACCESS_KEY: "blob-secret",
      LLM_DISPATCH_QUEUE_ACCESS_KEY_ID: "queue-id",
      LLM_DISPATCH_QUEUE_SECRET_ACCESS_KEY: "queue-secret",
      DATABASE_USERNAME: "dbuser",
      DATABASE_PASSWORD: "dbpass",
    };
  }

  function buildConfig(): ConvAgentConfig {
    return new ConvAgentConfig(
      3001,
      {
        credentials: null,
        url: "postgres://localhost/thoth",
      },
      {
        bucket: "bucket",
        credentials: null,
        endpoint: "http://localhost:9000",
        folder: "conv-agent",
        region: "us-east-1",
      },
      {
        credentials: null,
        queueUrl: "http://localhost:4566/queue",
        region: "us-east-1",
      },
    );
  }

  test("profile config starts with null credentials", () => {
    const config = getConvAgentConfig("local");

    expect(config.database.credentials).toBeNull();
    expect(config.blobStorage.credentials).toBeNull();
    expect(config.llmDispatchQueue.credentials).toBeNull();
  });

  test("populates credential properties when all keys are set", () => {
    const config = buildConfig();

    config.populateCredentials(buildEnv());

    expect(config).toMatchObject({
      blobStorage: {
        credentials: {
          accessKeyId: "blob-id",
          secretAccessKey: "blob-secret",
        },
      },
      llmDispatchQueue: {
        credentials: {
          accessKeyId: "queue-id",
          secretAccessKey: "queue-secret",
        },
      },
      database: {
        credentials: {
          username: "dbuser",
          password: "dbpass",
        },
      },
    });
  });

  test("keeps later credential properties null when population fails early", () => {
    const config = buildConfig();
    const env = buildEnv();
    delete env.LLM_DISPATCH_QUEUE_ACCESS_KEY_ID;

    expect(() => config.populateCredentials(env)).toThrow("LLM_DISPATCH_QUEUE_ACCESS_KEY_ID is required.");
    expect(config.blobStorage.credentials).toEqual({
      accessKeyId: "blob-id",
      secretAccessKey: "blob-secret",
    });
    expect(config.llmDispatchQueue.credentials).toBeNull();
    expect(config.database.credentials).toBeNull();
  });

  for (const key of REQUIRED_KEYS) {
    test(`throws when ${key} is missing`, () => {
      const env = buildEnv();
      delete env[key];

      expect(() => buildConfig().populateCredentials(env)).toThrow(`${key} is required.`);
    });

    test(`throws when ${key} is an empty string`, () => {
      const env = buildEnv();
      env[key] = "";

      expect(() => buildConfig().populateCredentials(env)).toThrow(`${key} is required.`);
    });
  }
});
