import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { PostgresAppendUserMessageStore } from "../adapter/postgres/postgres-append-user-message-store";
import { PostgresMessageRepository } from "../adapter/postgres/postgres-message-repository";
import { LLMMessageType } from "../domain/objects/llm";
import { convIntegrationSetup, type ConvIntegrationSetup } from "./conv-agent-it-setup";

const IMAGE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "resources/lambo.jpg");

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
    // Create a fresh conversation for the pagination scenario.
    const createResponse = await fetch(new URL("/conversations", startedSetup.server.url), {
      method: "POST",
    });

    expect(createResponse.status).toBe(201);

    const createdConversation = await createResponse.json();

    expect(createdConversation.id).toEqual(expect.any(String));
    conversationId = createdConversation.id;

    // Append 10 image-backed user messages; each append also creates an assistant reply.
    for (let index = 1; index <= 10; index += 1) {
      const appendResponse = await fetch(new URL(`/conversations/${conversationId}/chat`, startedSetup.server.url), {
        method: "POST",
        body: buildImageMessageFormData(imageBytes, `Manual lambo image upload ${index}`),
      });

      expect(appendResponse.status).toBe(204);
      expect(await appendResponse.text()).toBe("");
    }

    // Confirm the conversation itself is still readable before paging messages.
    const getConversationResponse = await fetch(new URL(`/conversations/${conversationId}`, startedSetup.server.url));

    expect(getConversationResponse.status).toBe(200);

    const fetchedConversation = await getConversationResponse.json();

    expect(fetchedConversation.id).toBe(conversationId);

    // Read the first 5 visible messages and assert alternating user/assistant output.
    const firstPageResponse = await fetch(new URL(`/conversations/${conversationId}/chat?pageNum=1&pageSize=5`, startedSetup.server.url));

    expect(firstPageResponse.status).toBe(200);

    const firstPage = await firstPageResponse.json();

    expect(firstPage.items).toHaveLength(5);
    expect(firstPage.pageNum).toBe(1);
    expect(firstPage.pageSize).toBe(5);

    for (let index = 0; index < 5; index += 1) {
      const expectedSequence = index + 1;
      const expectedMessageIndex = Math.ceil(expectedSequence / 2);
      const expectedType = expectedSequence % 2 === 1 ? "user" : "assistant";
      expect(firstPage.items[index]?.conversationId).toBe(conversationId);
      expect(firstPage.items[index]?.sequenceNumber).toBe(expectedSequence);
      expect(firstPage.items[index]?.type).toBe(expectedType);
      expect(firstPage.items[index]?.content).toBe(`Manual lambo image upload ${expectedMessageIndex}`);
      if (expectedType === "user") {
        expect(firstPage.items[index]?.files).toHaveLength(1);
        expect(firstPage.items[index]?.files[0]).toMatchObject({
          filename: "lambo.jpg",
          mimeType: "image/jpeg",
          sizeInBytes: imageBytes.byteLength,
        });
      } else {
        expect(firstPage.items[index]?.files).toEqual([]);
      }
    }

    // Read the second 5 visible messages and assert the sequence continues.
    const secondPageResponse = await fetch(new URL(`/conversations/${conversationId}/chat?pageNum=2&pageSize=5`, startedSetup.server.url));

    expect(secondPageResponse.status).toBe(200);

    const secondPage = await secondPageResponse.json();

    expect(secondPage.items).toHaveLength(5);
    expect(secondPage.pageNum).toBe(2);
    expect(secondPage.pageSize).toBe(5);

    for (let index = 0; index < 5; index += 1) {
      const expectedSequence = index + 6;
      const expectedMessageIndex = Math.ceil(expectedSequence / 2);
      const expectedType = expectedSequence % 2 === 1 ? "user" : "assistant";
      expect(secondPage.items[index]?.conversationId).toBe(conversationId);
      expect(secondPage.items[index]?.sequenceNumber).toBe(expectedSequence);
      expect(secondPage.items[index]?.type).toBe(expectedType);
      expect(secondPage.items[index]?.content).toBe(`Manual lambo image upload ${expectedMessageIndex}`);
      if (expectedType === "user") {
        expect(secondPage.items[index]?.files).toHaveLength(1);
        expect(secondPage.items[index]?.files[0]).toMatchObject({
          filename: "lambo.jpg",
          mimeType: "image/jpeg",
          sizeInBytes: imageBytes.byteLength,
        });
      } else {
        expect(secondPage.items[index]?.files).toEqual([]);
      }
    }

    // Delete the conversation and verify the API reports it as gone.
    const deleteResponse = await fetch(new URL(`/conversations/${conversationId}`, startedSetup.server.url), {
      method: "DELETE",
    });

    expect(deleteResponse.status).toBe(204);
    conversationId = undefined;

    const missingConversationResponse = await fetch(new URL(`/conversations/${createdConversation.id}`, startedSetup.server.url));

    expect(missingConversationResponse.status).toBe(404);
    expect(await missingConversationResponse.json()).toEqual({
      error: {
        entityType: "Conversation",
        id: createdConversation.id,
        kind: "NotFoundError",
      },
    });
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
        content: "first",
        createdAt,
        updatedAt: createdAt,
      }),
      messageRepository.insertNextMessageRow({
        conversationId,
        type: LLMMessageType.User,
        content: "second",
        createdAt,
        updatedAt: createdAt,
      }),
    ]);

    expect(firstInsertResult.ok).toBe(true);
    expect(secondInsertResult.ok).toBe(true);

    const messagesResult = await messageRepository.selectAllMessagesByConversation(conversationId);

    expect(messagesResult.ok).toBe(true);

    if (!messagesResult.ok) {
      throw new Error(messagesResult.error.message);
    }

    expect(messagesResult.value).toHaveLength(2);
    expect(messagesResult.value.map((message) => message.sequenceNumber)).toEqual([1, 2]);
    expect(new Set(messagesResult.value.map((message) => message.id)).size).toBe(2);
    expect(messagesResult.value.map((message) => message.content).sort()).toEqual(["first", "second"]);
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
      conversationId,
      type: LLMMessageType.User,
      content: "hello",
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
      conversationId,
      type: LLMMessageType.User,
      content: "hello",
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

  await fetch(new URL(`/conversations/${conversationId}`, startedSetup.server.url), {
    method: "DELETE",
  });
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
