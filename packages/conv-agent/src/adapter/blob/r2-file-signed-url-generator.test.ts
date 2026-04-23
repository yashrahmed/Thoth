import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, test } from "bun:test";
import { File } from "../../domain/objects/message-types";
import { R2FileSignedUrlGenerator } from "./r2-file-signed-url-generator";

const config = {
  endpoint: "https://account-id.r2.cloudflarestorage.com",
  bucket: "thoth-obj-store-dev",
  region: "auto",
  folder: "conv-agent",
};

const file = new File(
  "file-1",
  "message-1",
  "/files/118c8107-c7d1-4fd6-8cb8-104eadb97ec4-lambo.jpg",
  "lambo.jpg",
  "image/jpeg",
  1,
  new Date("2026-04-23T00:00:00.000Z"),
  new Date("2026-04-23T00:00:00.000Z"),
);

function createGenerator(): R2FileSignedUrlGenerator {
  const client = new S3Client({
    credentials: {
      accessKeyId: "test-access-key",
      secretAccessKey: "test-secret-key",
    },
    endpoint: config.endpoint,
    region: config.region,
  });

  return new R2FileSignedUrlGenerator(config, client);
}

describe("R2FileSignedUrlGenerator", () => {
  test("creates a signed GET URL with a two-minute default expiry", async () => {
    const result = await createGenerator().createSignedUrl(file);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const url = new URL(result.value);
    expect(url.hostname).toBe("thoth-obj-store-dev.account-id.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/conv-agent/files/118c8107-c7d1-4fd6-8cb8-104eadb97ec4-lambo.jpg");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Content-Sha256")).toBe("UNSIGNED-PAYLOAD");
    expect(url.searchParams.get("x-id")).toBe("GetObject");
  });

  test("uses the requested expiry_time_sec value", async () => {
    const result = await createGenerator().createSignedUrl(file, { expiry_time_sec: 60 });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const url = new URL(result.value);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
  });

  test("returns a store error for invalid expiry_time_sec values", async () => {
    const result = await createGenerator().createSignedUrl(file, { expiry_time_sec: 0 });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.message).toContain("Signed URL expiration must be an integer");
  });
});
