import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, test } from "bun:test";

const BASE_URL = process.env.CONV_AGENT_URL ?? "http://127.0.0.1:3001";
const IMAGE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "resources/lambo.jpg");
const COMPLETION_TIMEOUT_MS = 10_000;
const COMPLETION_POLL_INTERVAL_MS = 100;

type MessageType = "user" | "assistant" | "system" | "tool";

interface MessageItem {
  readonly id: string;
  readonly conversationId: string;
  readonly type: MessageType;
  readonly sequenceNumber: number;
  readonly content: string;
  readonly files: ReadonlyArray<{
    readonly filename: string;
    readonly mimeType: string;
    readonly sizeInBytes: number;
  }>;
}

interface MessagePage {
  readonly items: ReadonlyArray<MessageItem>;
  readonly pageNum: number;
  readonly pageSize: number;
}

beforeAll(async () => {
  const response = await fetch(`${BASE_URL}/health`);

  if (!response.ok) {
    throw new Error(`conv-agent health check failed at ${BASE_URL}/health (status ${response.status}).`);
  }
});

test("creates 10 user messages plus assistant replies, paginates 5 at a time, and cleans up", async () => {
  const imageBuffer = readFileSync(IMAGE_PATH);
  const imageBytes = imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength) as ArrayBuffer;
  let conversationId: string | undefined;

  try {
    const createResponse = await fetch(`${BASE_URL}/conversations`, { method: "POST" });

    expect(createResponse.status).toBe(201);

    const createdConversation = (await createResponse.json()) as { readonly id: string };

    expect(createdConversation.id).toEqual(expect.any(String));
    conversationId = createdConversation.id;

    for (let index = 1; index <= 10; index += 1) {
      const appendResponse = await fetch(`${BASE_URL}/conversations/${conversationId}/chat`, {
        method: "POST",
        body: buildImageMessageFormData(imageBytes, `Manual lambo image upload ${index}`),
      });

      expect(appendResponse.status).toBe(204);
      expect(await appendResponse.text()).toBe("");

      // Wait for the assistant reply before sending the next user message so sequence
      // numbers strictly alternate user/assistant. The placeholder LLM is fast, but the
      // queue handler is async — without this the asserted ordering is racy.
      await waitForConversationMessages(conversationId, index * 2);
    }

    const firstPage = await fetchPage(conversationId, 1, 5);

    expect(firstPage.items).toHaveLength(5);
    expect(firstPage.pageNum).toBe(1);
    expect(firstPage.pageSize).toBe(5);
    assertAlternatingMessages(firstPage.items, conversationId, 1, imageBytes.byteLength);

    const secondPage = await fetchPage(conversationId, 2, 5);

    expect(secondPage.items).toHaveLength(5);
    expect(secondPage.pageNum).toBe(2);
    expect(secondPage.pageSize).toBe(5);
    assertAlternatingMessages(secondPage.items, conversationId, 6, imageBytes.byteLength);

    const conversationResponse = await fetch(`${BASE_URL}/conversations/${conversationId}`);

    expect(conversationResponse.status).toBe(200);
    expect(((await conversationResponse.json()) as { readonly id: string }).id).toBe(conversationId);

    const deleteResponse = await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE" });

    expect(deleteResponse.status).toBe(204);

    const deletedId = conversationId;
    conversationId = undefined;

    const missingResponse = await fetch(`${BASE_URL}/conversations/${deletedId}`);

    expect(missingResponse.status).toBe(404);

    const missingBody = (await missingResponse.json()) as { readonly error: { readonly kind: string; readonly entityType: string; readonly id: string } };

    expect(missingBody).toEqual({
      error: {
        kind: "NotFoundError",
        entityType: "Conversation",
        id: deletedId,
      },
    });
  } finally {
    if (conversationId) {
      await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE" });
    }
  }
});

function buildImageMessageFormData(imageBytes: ArrayBuffer, content: string): FormData {
  const formData = new FormData();
  formData.set("type", "user");
  formData.set("content", content);
  formData.set("file", new Blob([imageBytes], { type: "image/jpeg" }), "lambo.jpg");

  return formData;
}

async function fetchPage(conversationId: string, pageNum: number, pageSize: number): Promise<MessagePage> {
  const response = await fetch(`${BASE_URL}/conversations/${conversationId}/chat?pageNum=${pageNum}&pageSize=${pageSize}`);

  expect(response.status).toBe(200);

  return (await response.json()) as MessagePage;
}

async function waitForConversationMessages(conversationId: string, expected: number): Promise<void> {
  const deadline = Date.now() + COMPLETION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const page = await fetchPage(conversationId, 1, expected + 1);

    if (page.items.length >= expected) {
      return;
    }

    await new Promise((resolveSleep) => setTimeout(resolveSleep, COMPLETION_POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for ${expected} messages on conversation ${conversationId}.`);
}

function assertAlternatingMessages(items: ReadonlyArray<MessageItem>, conversationId: string, startSequence: number, imageSize: number): void {
  for (let index = 0; index < items.length; index += 1) {
    const expectedSequence = startSequence + index;
    const expectedMessageIndex = Math.ceil(expectedSequence / 2);
    const expectedType: MessageType = expectedSequence % 2 === 1 ? "user" : "assistant";
    const item = items[index];

    expect(item.conversationId).toBe(conversationId);
    expect(item.sequenceNumber).toBe(expectedSequence);
    expect(item.type).toBe(expectedType);
    expect(item.content).toBe(`Manual lambo image upload ${expectedMessageIndex}`);

    if (expectedType === "user") {
      expect(item.files).toHaveLength(1);
      expect(item.files[0]).toMatchObject({
        filename: "lambo.jpg",
        mimeType: "image/jpeg",
        sizeInBytes: imageSize,
      });
    } else {
      expect(item.files).toEqual([]);
    }
  }
}
