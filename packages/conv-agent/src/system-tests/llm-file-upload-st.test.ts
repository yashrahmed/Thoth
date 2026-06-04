import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { R2BlobRepository } from "../adapter/blob/r2-blob-repository";
import { R2FileSignedUrlGenerator } from "../adapter/blob/r2-file-signed-url-generator";
import { OpenAiLlmAdapter } from "../adapter/llm/openai-llm-adapter";
import type { BlobStorageConfig } from "../config/config";
import { LLMMessageType, type LlmCompletionInputMessage } from "../domain/objects/llm";
import { File as DomainFile } from "../domain/objects/message-types";

const TEST_MESSAGE = "What's in this picture?";
const TEXT_ONLY_TEST_MESSAGE = "What is the Capital of Djibouti? And how old it the country?";
const TEST_FILE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../test-files/plane1.png");
const TEST_FILE_MIME_TYPE = "image/png";
const TEST_FILE_BUCKET = "thoth-obj-store-dev";
const TEST_FILE_FOLDER = "conv-agent/test-files";
const DEFAULT_BLOB_STORAGE_REGION = "auto";
const SIGNED_URL_EXPIRES_IN_SECONDS = 600;

describe("LLM file upload system test", () => {
  test("uploads a test image to R2, signs it, sends it to the LLM, and prints the response", async () => {
    const response = await completeWithUploadedTestFile();

    console.log(response);
    expect(response.trim().length).toBeGreaterThan(0);
  });

  test("sends a text-only message to the LLM and prints the response", async () => {
    const response = await completeWithMessages([
      {
        type: LLMMessageType.User,
        content: TEXT_ONLY_TEST_MESSAGE,
        files: [],
      },
    ]);

    console.log(response);
    expect(response.trim().length).toBeGreaterThan(0);
  });
});

async function completeWithUploadedTestFile(): Promise<string> {
  const blobStorageConfig: BlobStorageConfig = {
    endpoint: requireEnv("BLOB_STORAGE_ENDPOINT"),
    bucket: TEST_FILE_BUCKET,
    region: process.env.BLOB_STORAGE_REGION ?? DEFAULT_BLOB_STORAGE_REGION,
    folder: TEST_FILE_FOLDER,
  };
  const blobStorageCredentials = {
    accessKeyId: requireEnv("BLOB_STORAGE_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("BLOB_STORAGE_SECRET_ACCESS_KEY"),
  };
  const filename = basename(TEST_FILE_PATH);
  const fileContent = await readFile(TEST_FILE_PATH);
  const fileBytes = fileContent.buffer.slice(fileContent.byteOffset, fileContent.byteOffset + fileContent.byteLength) as ArrayBuffer;
  const blobRepository = new R2BlobRepository(blobStorageConfig, blobStorageCredentials);
  const uploadResult = await blobRepository.putBlob({
    content: fileBytes,
    filename,
    mimeType: TEST_FILE_MIME_TYPE,
  });

  if (!uploadResult.ok) {
    throw new Error(`Failed to upload ${filename}: ${uploadResult.error.message}`);
  }

  const fileSignedUrlGenerator = new R2FileSignedUrlGenerator(
    blobStorageConfig,
    new S3Client({
      endpoint: blobStorageConfig.endpoint,
      region: blobStorageConfig.region,
      credentials: blobStorageCredentials,
      forcePathStyle: true,
    }),
  );
  const now = new Date();
  const signedUrlResult = await fileSignedUrlGenerator.createSignedUrl(
    new DomainFile("llm-file-upload-st-file", "llm-file-upload-st-message", uploadResult.value, filename, TEST_FILE_MIME_TYPE, fileBytes.byteLength, now, now),
    { expiry_time_sec: SIGNED_URL_EXPIRES_IN_SECONDS },
  );

  if (!signedUrlResult.ok) {
    throw new Error(`Failed to sign ${filename}: ${signedUrlResult.error.message}`);
  }

  const messages: LlmCompletionInputMessage[] = [
    {
      type: LLMMessageType.User,
      content: TEST_MESSAGE,
      files: [
        {
          filename,
          mimeType: TEST_FILE_MIME_TYPE,
          signedUrl: signedUrlResult.value,
        },
      ],
    },
  ];
  return completeWithMessages(messages);
}

async function completeWithMessages(messages: ReadonlyArray<LlmCompletionInputMessage>): Promise<string> {
  const completionResult = await new OpenAiLlmAdapter({ apiKey: requireEnv("OPENAI_LLM_API_KEY") }).llmComplete(messages);

  if (!completionResult.ok) {
    throw new Error(`LLM completion failed: ${completionResult.error.message}`);
  }

  return completionResult.value.messages.map((message) => message.content).join("\n");
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}
