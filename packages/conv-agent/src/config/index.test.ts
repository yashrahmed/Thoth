import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { readConvAgentCredentials, resolveConfigFilePath } from "./index";

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

describe("readConvAgentCredentials", () => {
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

  test("returns a shaped credentials object when all keys are set", () => {
    expect(readConvAgentCredentials(buildEnv())).toEqual({
      blobStorage: {
        accessKeyId: "blob-id",
        secretAccessKey: "blob-secret",
      },
      llmDispatchQueue: {
        accessKeyId: "queue-id",
        secretAccessKey: "queue-secret",
      },
      database: {
        username: "dbuser",
        password: "dbpass",
      },
    });
  });

  for (const key of REQUIRED_KEYS) {
    test(`throws when ${key} is missing`, () => {
      const env = buildEnv();
      delete env[key];

      expect(() => readConvAgentCredentials(env)).toThrow(`${key} is required.`);
    });

    test(`throws when ${key} is an empty string`, () => {
      const env = buildEnv();
      env[key] = "";

      expect(() => readConvAgentCredentials(env)).toThrow(`${key} is required.`);
    });
  }
});
