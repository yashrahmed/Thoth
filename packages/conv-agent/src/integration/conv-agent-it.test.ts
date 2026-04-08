import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { PostgresAppendUserMessageStore } from "../adapter/postgres/postgres-append-user-message-store";
import { PostgresDeleteConversationGraphStore } from "../adapter/postgres/postgres-delete-conversation-graph-store";
import { PostgresMessageRepository } from "../adapter/postgres/postgres-message-repository";
import { LLMMessageType } from "../domain/objects/llm";
import { setupAndLaunch, type SetupAndLaunchResult } from "../setup-and-launch";

const IMAGE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "resources/lambo.jpg");
const CLEANUP_TIMEOUT_MS = 5_000;
const COMPLETION_TIMEOUT_MS = 5_000;
const COMPLETION_POLL_INTERVAL_MS = 100;
const DATABASE_NAME = "thoth_test";
const DATABASE_USERNAME = "thoth";
const DATABASE_PASSWORD = "thoth";
const DATABASE_HOST = "127.0.0.1";
const DATABASE_PORT = 55432;
const BLOB_BUCKET = "thoth-test";
const BLOB_FOLDER = "integration";
const BLOB_REGION = "us-east-1";
const SQS_REGION = "us-east-1";
const SQS_QUEUE_NAME = "thoth-llm-completions-queue";
const LOCALSTACK_ENDPOINT = "http://127.0.0.1:54566";
const BLOB_ENDPOINT = LOCALSTACK_ENDPOINT;

type ConvIntegrationSetup = SetupAndLaunchResult;
type ConversationRecord = { readonly id: string };
type ConversationMessageItem = {
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly type: string;
  readonly content: string;
  readonly files: Array<{
    readonly filename: string;
    readonly mimeType: string;
    readonly sizeInBytes: number;
  }>;
};
type ConversationMessagePage = {
  readonly items: Array<ConversationMessageItem>;
  readonly pageNum: number;
  readonly pageSize: number;
};

let setup: ConvIntegrationSetup | undefined;

beforeAll(async () => {
  setup = await convIntegrationSetup();
});

afterAll(async () => {
  await setup?.stop();
  setup = undefined;
});

test("creates 10 user messages plus assistant replies, paginates 5 at a time, and cleans up", async () => {
  const startedSetup = requireSetup();
  let conversationId: string | undefined;
  const imageBytes = readFileSync(IMAGE_PATH);

  try {
    const createdConversation = await createConversation(startedSetup);
    conversationId = createdConversation.id;
    await appendImageMessages(startedSetup, conversationId, imageBytes, 10);
    const allMessages = await waitForConversationMessages(startedSetup, createdConversation.id, 20);

    expect(allMessages).toHaveLength(20);
    expect(allMessages.some((message) => message.type === "assistant")).toBe(true);
    await expectConversationExists(startedSetup, conversationId);
    const firstPage = await fetchConversationMessagePage(startedSetup, conversationId, 1, 5);
    assertConversationMessagePage(firstPage, conversationId, 1, imageBytes.byteLength);
    const secondPage = await fetchConversationMessagePage(startedSetup, conversationId, 2, 5);
    assertConversationMessagePage(secondPage, conversationId, 6, imageBytes.byteLength);
    await deleteConversation(startedSetup, conversationId);
    conversationId = undefined;
    await expectConversationMissing(startedSetup, createdConversation.id);
  } finally {
    // Clean up the conversation if the test failed before the explicit delete.
    await deleteConversationIfPresent(startedSetup, conversationId);
  }
});

test("allocates message sequence numbers transactionally for concurrent inserts on one conversation", async () => {
  const startedSetup = requireSetup();
  let conversationId: string | undefined;

  try {
    const createResponse = await fetch(new URL("/conversations", startedSetup.server.url), {
      method: "POST",
    });

    expect(createResponse.status).toBe(201);

    const createdConversation = (await createResponse.json()) as { readonly id: string };
    conversationId = createdConversation.id;

    const messageRepository = new PostgresMessageRepository(startedSetup.database);
    const createdAt = new Date("2026-03-29T12:00:00.000Z");

    const [firstInsertResult, secondInsertResult] = await Promise.all([
      messageRepository.insertNextMessageRow({
        conversationId,
        type: LLMMessageType.User,
        sequenceNumber: 1,
        content: "first",
        createdAt,
        updatedAt: createdAt,
      }),
      messageRepository.insertNextMessageRow({
        conversationId,
        type: LLMMessageType.User,
        sequenceNumber: 1,
        content: "second",
        createdAt,
        updatedAt: createdAt,
      }),
    ]);

    expect([firstInsertResult.ok, secondInsertResult.ok].sort()).toEqual([false, true]);
    const successfulInsertResult = firstInsertResult.ok ? firstInsertResult : secondInsertResult;
    const failedInsertResult = firstInsertResult.ok ? secondInsertResult : firstInsertResult;

    if (!successfulInsertResult.ok) {
      throw new Error("Expected one insert to succeed.");
    }

    expect(failedInsertResult).toEqual({
      ok: false,
      error: {
        kind: "ValidationError",
        fieldName: "sequenceNumber",
        message: expect.any(String),
      },
    });

    const messagesResult = await messageRepository.selectAllMessagesByConversation(conversationId);

    expect(messagesResult.ok).toBe(true);

    if (!messagesResult.ok) {
      throw new Error(messagesResult.error.message);
    }

    expect(messagesResult.value).toHaveLength(1);
    expect(messagesResult.value.map((message) => message.sequenceNumber)).toEqual([1]);
    expect(messagesResult.value.map((message) => message.content)).toEqual([successfulInsertResult.value.content]);
  } finally {
    await deleteConversationIfPresent(startedSetup, conversationId);
  }
});

test("persists one user message plus file rows transactionally through the composite append store", async () => {
  const startedSetup = requireSetup();
  let conversationId: string | undefined;

  try {
    const createResponse = await fetch(new URL("/conversations", startedSetup.server.url), {
      method: "POST",
    });

    expect(createResponse.status).toBe(201);

    const createdConversation = (await createResponse.json()) as { readonly id: string };
    conversationId = createdConversation.id;

    const store = new PostgresAppendUserMessageStore(startedSetup.database);
    const result = await store.persistUserMessageWithFiles({
      message: {
        conversationId,
        type: LLMMessageType.User,
        sequenceNumber: 1,
        content: "hello",
        createdAt: new Date("2026-03-30T12:00:00.000Z"),
        updatedAt: new Date("2026-03-30T12:00:00.000Z"),
      },
      files: [
        {
          canonicalUrl: "/files/a.txt",
          filename: "a.txt",
          mimeType: "text/plain",
          sizeInBytes: 1,
        },
        {
          canonicalUrl: "/files/b.txt",
          filename: "b.txt",
          mimeType: "text/plain",
          sizeInBytes: 2,
        },
      ],
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.message);
    }

    expect(result.value.conversationId).toBe(conversationId);
    expect(result.value.sequenceNumber).toBe(1);
    expect(result.value.content).toBe("hello");

    const fileRows = await startedSetup.database<{ filename: string; message_id: string }[]>`
      select filename, message_id
      from thoth.files
      where message_id = ${result.value.id}
      order by filename asc
    `;

    expect(fileRows).toHaveLength(2);
    expect(fileRows.map((row) => row.filename)).toEqual(["a.txt", "b.txt"]);
    expect(new Set(fileRows.map((row) => row.message_id))).toEqual(new Set([result.value.id]));
  } finally {
    await deleteConversationIfPresent(startedSetup, conversationId);
  }
});

test("rolls back both the user message and file rows when the composite append store fails", async () => {
  const startedSetup = requireSetup();
  let conversationId: string | undefined;

  try {
    const createResponse = await fetch(new URL("/conversations", startedSetup.server.url), {
      method: "POST",
    });

    expect(createResponse.status).toBe(201);

    const createdConversation = (await createResponse.json()) as { readonly id: string };
    conversationId = createdConversation.id;

    const store = new PostgresAppendUserMessageStore(startedSetup.database);
    const result = await store.persistUserMessageWithFiles({
      message: {
        conversationId,
        type: LLMMessageType.User,
        sequenceNumber: 1,
        content: "hello",
        createdAt: new Date("2026-03-30T12:00:00.000Z"),
        updatedAt: new Date("2026-03-30T12:00:00.000Z"),
      },
      files: [
        {
          canonicalUrl: "/files/a.txt",
          filename: "a.txt",
          mimeType: "text/plain",
          sizeInBytes: 1,
        },
        {
          canonicalUrl: "/files/overflow.txt",
          filename: "overflow.txt",
          mimeType: "text/plain",
          sizeInBytes: 3_000_000_000,
        },
      ],
    });

    expect(result.ok).toBe(false);

    const messageRows = await startedSetup.database<{ count: string }[]>`
      select count(*)::text as count
      from thoth.messages
      where conversation_id = ${conversationId}
    `;
    const fileRows = await startedSetup.database<{ count: string }[]>`
      select count(*)::text as count
      from thoth.files
      where message_id in (
        select id
        from thoth.messages
        where conversation_id = ${conversationId}
      )
    `;

    expect(messageRows[0]?.count).toBe("0");
    expect(fileRows[0]?.count).toBe("0");
  } finally {
    await deleteConversationIfPresent(startedSetup, conversationId);
  }
});

test("rejects stale sequence numbers through the composite append store", async () => {
  const startedSetup = requireSetup();
  let conversationId: string | undefined;

  try {
    const createResponse = await fetch(new URL("/conversations", startedSetup.server.url), {
      method: "POST",
    });

    expect(createResponse.status).toBe(201);

    const createdConversation = (await createResponse.json()) as { readonly id: string };
    conversationId = createdConversation.id;

    const store = new PostgresAppendUserMessageStore(startedSetup.database);
    const firstInsertResult = await store.persistUserMessageWithFiles({
      message: {
        conversationId,
        type: LLMMessageType.User,
        sequenceNumber: 1,
        content: "hello",
        createdAt: new Date("2026-03-30T12:00:00.000Z"),
        updatedAt: new Date("2026-03-30T12:00:00.000Z"),
      },
      files: [],
    });

    expect(firstInsertResult.ok).toBe(true);

    const staleInsertResult = await store.persistUserMessageWithFiles({
      message: {
        conversationId,
        type: LLMMessageType.User,
        sequenceNumber: 1,
        content: "stale",
        createdAt: new Date("2026-03-30T12:01:00.000Z"),
        updatedAt: new Date("2026-03-30T12:01:00.000Z"),
      },
      files: [],
    });

    expect(staleInsertResult).toEqual({
      ok: false,
      error: {
        kind: "ValidationError",
        fieldName: "sequenceNumber",
        message: expect.any(String),
      },
    });
  } finally {
    await deleteConversationIfPresent(startedSetup, conversationId);
  }
});

test("deletes the DB conversation graph transactionally and returns blob URLs for later cleanup", async () => {
  const startedSetup = requireSetup();
  let conversationId: string | undefined;
  const imageBytes = readFileSync(IMAGE_PATH);

  try {
    const createResponse = await fetch(new URL("/conversations", startedSetup.server.url), {
      method: "POST",
    });

    expect(createResponse.status).toBe(201);

    const createdConversation = (await createResponse.json()) as { readonly id: string };
    conversationId = createdConversation.id;

    const appendResponse = await fetch(new URL(`/conversations/${conversationId}/chat`, startedSetup.server.url), {
      method: "POST",
      body: buildImageMessageFormData(imageBytes, "delete me"),
    });

    expect(appendResponse.status).toBe(204);

    const graphStore = new PostgresDeleteConversationGraphStore(startedSetup.database);
    const deleteResult = await graphStore.deleteConversationGraph(conversationId);

    expect(deleteResult.ok).toBe(true);

    if (!deleteResult.ok) {
      throw new Error(deleteResult.error.kind);
    }

    expect(deleteResult.value.canonicalUrls).toHaveLength(1);
    const deletedCanonicalUrls = deleteResult.value.canonicalUrls;

    const conversationRows = await startedSetup.database<{ count: string }[]>`
      select count(*)::text as count
      from thoth.conversations
      where id = ${conversationId}
    `;
    const messageRows = await startedSetup.database<{ count: string }[]>`
      select count(*)::text as count
      from thoth.messages
      where conversation_id = ${conversationId}
    `;
    const fileRows = await startedSetup.database<{ count: string }[]>`
      select count(*)::text as count
      from thoth.files
      where canonical_url = any(${deletedCanonicalUrls as string[]})
    `;

    expect(conversationRows[0]?.count).toBe("0");
    expect(messageRows[0]?.count).toBe("0");
    expect(fileRows[0]?.count).toBe("0");
    conversationId = undefined;
  } finally {
    await deleteConversationIfPresent(startedSetup, conversationId);
  }
});

async function convIntegrationSetup(): Promise<ConvIntegrationSetup> {
  return setupAndLaunch({
    port: 0,
    databaseUrl: buildDatabaseUrl(DATABASE_HOST, DATABASE_PORT),
    blobStorage: {
      accessKeyId: "test",
      bucket: BLOB_BUCKET,
      endpoint: BLOB_ENDPOINT,
      folder: BLOB_FOLDER,
      region: BLOB_REGION,
      secretAccessKey: "test",
      bootstrap: {
        createBucket: true,
        forcePathStyle: true,
      },
    },
    llmDispatchQueue: {
      endpoint: LOCALSTACK_ENDPOINT,
      region: SQS_REGION,
      accessKeyId: "test",
      secretAccessKey: "test",
      bootstrap: {
        createQueue: true,
        queueName: SQS_QUEUE_NAME,
      },
    },
  });
}

function requireSetup(): ConvIntegrationSetup {
  if (!setup) {
    throw new Error("Integration setup was not started.");
  }

  return setup;
}

async function deleteConversationIfPresent(startedSetup: ConvIntegrationSetup, conversationId: string | undefined): Promise<void> {
  if (!conversationId) {
    return;
  }

  try {
    await fetch(new URL(`/conversations/${conversationId}`, startedSetup.server.url), {
      method: "DELETE",
      signal: AbortSignal.timeout(CLEANUP_TIMEOUT_MS),
    });
  } catch {
    // Best-effort cleanup. The main test assertions should have already run.
  }
}

async function createConversation(startedSetup: ConvIntegrationSetup): Promise<ConversationRecord> {
  const response = await fetch(new URL("/conversations", startedSetup.server.url), {
    method: "POST",
  });

  expect(response.status).toBe(201);

  const conversation = (await response.json()) as ConversationRecord;

  expect(conversation.id).toEqual(expect.any(String));
  return conversation;
}

async function appendImageMessages(startedSetup: ConvIntegrationSetup, conversationId: string, imageBytes: Uint8Array, count: number): Promise<void> {
  for (let index = 1; index <= count; index += 1) {
    const response = await fetch(new URL(`/conversations/${conversationId}/chat`, startedSetup.server.url), {
      method: "POST",
      body: buildImageMessageFormData(imageBytes, `Manual lambo image upload ${index}`),
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  }
}

async function expectConversationExists(startedSetup: ConvIntegrationSetup, conversationId: string): Promise<void> {
  const response = await fetch(new URL(`/conversations/${conversationId}`, startedSetup.server.url));

  expect(response.status).toBe(200);

  const conversation = (await response.json()) as ConversationRecord;

  expect(conversation.id).toBe(conversationId);
}

async function fetchConversationMessagePage(startedSetup: ConvIntegrationSetup, conversationId: string, pageNum: number, pageSize: number): Promise<ConversationMessagePage> {
  const response = await fetch(new URL(`/conversations/${conversationId}/chat?pageNum=${pageNum}&pageSize=${pageSize}`, startedSetup.server.url));

  expect(response.status).toBe(200);
  return (await response.json()) as ConversationMessagePage;
}

function assertConversationMessagePage(page: ConversationMessagePage, conversationId: string, firstSequenceNumber: number, imageSizeInBytes: number): void {
  expect(page.items).toHaveLength(5);
  expect(page.pageNum).toBe(Math.ceil(firstSequenceNumber / 5));
  expect(page.pageSize).toBe(5);

  for (let index = 0; index < page.items.length; index += 1) {
    assertConversationMessageItem(page.items[index], conversationId, firstSequenceNumber + index, imageSizeInBytes);
  }
}

function assertConversationMessageItem(item: ConversationMessageItem | undefined, conversationId: string, expectedSequenceNumber: number, imageSizeInBytes: number): void {
  const expectedMessageIndex = Math.ceil(expectedSequenceNumber / 2);
  const expectedType = expectedSequenceNumber % 2 === 1 ? "user" : "assistant";

  expect(item?.conversationId).toBe(conversationId);
  expect(item?.sequenceNumber).toBe(expectedSequenceNumber);
  expect(item?.type).toBe(expectedType);
  expect(item?.content).toBe(`Manual lambo image upload ${expectedMessageIndex}`);

  if (expectedType === "assistant") {
    expect(item?.files).toEqual([]);
    return;
  }

  expect(item?.files).toHaveLength(1);
  expect(item?.files[0]).toMatchObject({
    filename: "lambo.jpg",
    mimeType: "image/jpeg",
    sizeInBytes: imageSizeInBytes,
  });
}

async function deleteConversation(startedSetup: ConvIntegrationSetup, conversationId: string): Promise<void> {
  const response = await fetch(new URL(`/conversations/${conversationId}`, startedSetup.server.url), {
    method: "DELETE",
  });

  expect(response.status).toBe(204);
}

async function expectConversationMissing(startedSetup: ConvIntegrationSetup, conversationId: string): Promise<void> {
  const response = await fetch(new URL(`/conversations/${conversationId}`, startedSetup.server.url));

  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: {
      entityType: "Conversation",
      id: conversationId,
      kind: "NotFoundError",
    },
  });
}

async function waitForConversationMessages(startedSetup: ConvIntegrationSetup, conversationId: string, expectedCount: number): Promise<Array<ConversationMessageItem>> {
  const deadline = Date.now() + COMPLETION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const response = await fetch(new URL(`/conversations/${conversationId}/chat?pageNum=1&pageSize=${expectedCount}`, startedSetup.server.url));

    expect(response.status).toBe(200);

    const page = (await response.json()) as ConversationMessagePage;

    if (page.items.length >= expectedCount) {
      return page.items;
    }

    await Bun.sleep(COMPLETION_POLL_INTERVAL_MS);
  }

  throw new Error(`Timed out waiting for ${expectedCount} conversation messages.`);
}

function buildImageMessageFormData(imageBytes: Uint8Array, text: string): FormData {
  const formData = new FormData();

  formData.set("type", "user");
  formData.set("content", text);
  formData.set(
    "attachment",
    new File([toArrayBuffer(imageBytes)], "lambo.jpg", {
      type: "image/jpeg",
    }),
  );

  return formData;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function buildDatabaseUrl(host: string, port: number): string {
  return `postgres://${DATABASE_USERNAME}:${DATABASE_PASSWORD}@${host}:${port}/${DATABASE_NAME}`;
}
