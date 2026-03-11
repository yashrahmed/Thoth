import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetConfigCache } from "@thoth/config";
import { R2BlobStore } from "./r2-blob-store";

describe("R2BlobStore", () => {
  let previousConfigFile: string | undefined;
  let previousAccessKeyId: string | undefined;
  let previousSecretAccessKey: string | undefined;
  let configDirectory: string;

  beforeEach(() => {
    configDirectory = mkdtempSync(join(tmpdir(), "thoth-r2-"));
    const configPath = join(configDirectory, "config.yaml");

    writeFileSync(
      configPath,
      [
        "objectStore:",
        "  endpoint: https://example-bucket.r2.cloudflarestorage.com",
        "  bucket: thoth",
        "  region: auto",
        "  service: s3",
        "ports:",
        "  proxy: 3000",
        "  convAgent: 3001",
        "  kbCurateAgent: 3002",
        "  planningAgent: 3003",
        "",
      ].join("\n"),
    );

    previousConfigFile = process.env.CONFIG_FILE;
    previousAccessKeyId = process.env.R2_ACCESS_KEY_ID;
    previousSecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    process.env.CONFIG_FILE = configPath;
    process.env.R2_ACCESS_KEY_ID = "access-key";
    process.env.R2_SECRET_ACCESS_KEY = "secret-key";
    resetConfigCache();
  });

  afterEach(() => {
    if (previousConfigFile === undefined) {
      delete process.env.CONFIG_FILE;
    } else {
      process.env.CONFIG_FILE = previousConfigFile;
    }

    if (previousAccessKeyId === undefined) {
      delete process.env.R2_ACCESS_KEY_ID;
    } else {
      process.env.R2_ACCESS_KEY_ID = previousAccessKeyId;
    }

    if (previousSecretAccessKey === undefined) {
      delete process.env.R2_SECRET_ACCESS_KEY;
    } else {
      process.env.R2_SECRET_ACCESS_KEY = previousSecretAccessKey;
    }

    resetConfigCache();
    rmSync(configDirectory, { recursive: true, force: true });
  });

  test("signs object upload requests", async () => {
    const fetchMock = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toBeDefined();
      const headers = init?.headers as Record<string, string>;

      expect(headers.authorization).toContain("AWS4-HMAC-SHA256");
      expect(headers["x-amz-date"]).toBeString();

      return new Response("", {
        status: 200,
        headers: {
          etag: "etag",
          date: "Wed, 11 Mar 2026 18:00:00 GMT",
        },
      });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const blobStore = new R2BlobStore();
    const result = await blobStore.putObject({
      objectKey: "conversations/demo/file.txt",
      body: new TextEncoder().encode("hello").buffer,
      contentType: "text/plain",
      byteSize: 5,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.objectKey).toBe("conversations/demo/file.txt");
    expect(result.etag).toBe("etag");
  });
});
