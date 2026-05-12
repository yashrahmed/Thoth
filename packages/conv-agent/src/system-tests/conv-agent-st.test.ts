import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "bun:test";

const BASE_URL = process.env.CONV_AGENT_URL ?? "http://127.0.0.1:3001";
const BEARER_TOKEN = process.env.CONV_AGENT_BEARER_TOKEN;
const IMAGE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "resources/lambo.jpg");
const COMPLETION_TIMEOUT_MS = 30_000;
const COMPLETION_POLL_INTERVAL_MS = 200;

if (!BEARER_TOKEN) {
  throw new Error("CONV_AGENT_BEARER_TOKEN is required to run system tests.");
}

const AUTH_HEADERS: Record<string, string> = { authorization: `Bearer ${BEARER_TOKEN}` };

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

interface ConversationItem {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

describe("conv-agent HTTP system test", () => {
  beforeAll(async () => {
    const response = await fetch(`${BASE_URL}/health`);

    if (!response.ok) {
      throw new Error(`conv-agent health check failed at ${BASE_URL}/health (status ${response.status}).`);
    }
  });

  test("updates a conversation title and cleans up", async () => {
    let conversationId: string | undefined;

    try {
      const createResponse = await fetch(`${BASE_URL}/conversations`, { method: "POST", headers: AUTH_HEADERS });

      expect(createResponse.status).toBe(201);

      const createdConversation = (await createResponse.json()) as ConversationItem;

      expect(createdConversation.id).toEqual(expect.any(String));
      expect(createdConversation.title).toBeNull();
      conversationId = createdConversation.id;

      const title = "Planning Notes";
      const updateResponse = await fetch(`${BASE_URL}/conversations/${conversationId}`, {
        method: "PATCH",
        headers: {
          ...AUTH_HEADERS,
          "content-type": "application/json",
        },
        body: JSON.stringify({ title }),
      });

      expect(updateResponse.status).toBe(200);

      const updatedConversation = (await updateResponse.json()) as ConversationItem;

      expect(updatedConversation.id).toBe(conversationId);
      expect(updatedConversation.title).toBe(title);
      expect(Date.parse(updatedConversation.updatedAt)).toBeGreaterThanOrEqual(Date.parse(createdConversation.updatedAt));

      const nullTitleResponse = await fetch(`${BASE_URL}/conversations/${conversationId}`, {
        method: "PATCH",
        headers: {
          ...AUTH_HEADERS,
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: null }),
      });

      expect(nullTitleResponse.status).toBe(400);

      const nullTitleBody = (await nullTitleResponse.json()) as { readonly error: { readonly kind: string; readonly fieldName: string; readonly message: string } };

      expect(nullTitleBody).toEqual({
        error: {
          kind: "ValidationError",
          fieldName: "title",
          message: "title must be present.",
        },
      });

      const conversationResponse = await fetch(`${BASE_URL}/conversations/${conversationId}`, { headers: AUTH_HEADERS });

      expect(conversationResponse.status).toBe(200);
      expect(await conversationResponse.json()).toMatchObject({ id: conversationId, title });
    } finally {
      if (conversationId) {
        await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      }
    }
  });

  test("appends 10 user messages directly, paginates them 4 at a time, and cleans up", async () => {
    const imageBuffer = readFileSync(IMAGE_PATH);
    const imageBytes = imageBuffer.buffer.slice(imageBuffer.byteOffset, imageBuffer.byteOffset + imageBuffer.byteLength) as ArrayBuffer;
    let conversationId: string | undefined;

    try {
      const createResponse = await fetch(`${BASE_URL}/conversations`, { method: "POST", headers: AUTH_HEADERS });

      expect(createResponse.status).toBe(201);

      const createdConversation = (await createResponse.json()) as { readonly id: string; readonly title: string | null };

      expect(createdConversation.id).toEqual(expect.any(String));
      expect(createdConversation.title).toBeNull();
      conversationId = createdConversation.id;

      for (let index = 1; index <= 10; index += 1) {
        const appendResponse = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: buildImageMessageFormData(imageBytes, `Manual lambo image upload ${index}`),
        });

        expect(appendResponse.status).toBe(204);
        expect(await appendResponse.text()).toBe("");
      }

      const firstPage = await fetchPage(conversationId, 1, 4);

      expect(firstPage.items).toHaveLength(4);
      expect(firstPage.pageNum).toBe(1);
      expect(firstPage.pageSize).toBe(4);
      assertUserMessages(firstPage.items, conversationId, 1, imageBytes.byteLength);

      const secondPage = await fetchPage(conversationId, 2, 4);

      expect(secondPage.items).toHaveLength(4);
      expect(secondPage.pageNum).toBe(2);
      expect(secondPage.pageSize).toBe(4);
      assertUserMessages(secondPage.items, conversationId, 5, imageBytes.byteLength);

      const thirdPage = await fetchPage(conversationId, 3, 4);

      expect(thirdPage.items).toHaveLength(2);
      expect(thirdPage.pageNum).toBe(3);
      expect(thirdPage.pageSize).toBe(4);
      assertUserMessages(thirdPage.items, conversationId, 9, imageBytes.byteLength);

      const conversationResponse = await fetch(`${BASE_URL}/conversations/${conversationId}`, { headers: AUTH_HEADERS });

      expect(conversationResponse.status).toBe(200);
      expect(await conversationResponse.json()).toMatchObject({ id: conversationId, title: null });

      const deleteResponse = await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });

      expect(deleteResponse.status).toBe(204);

      const deletedId = conversationId;
      conversationId = undefined;

      const missingResponse = await fetch(`${BASE_URL}/conversations/${deletedId}`, { headers: AUTH_HEADERS });

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
        await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      }
    }
  });

  test("posts a single user message and receives an assistant completion reply", async () => {
    let conversationId: string | undefined;

    try {
      const createResponse = await fetch(`${BASE_URL}/conversations`, { method: "POST", headers: AUTH_HEADERS });

      expect(createResponse.status).toBe(201);

      const createdConversation = (await createResponse.json()) as { readonly id: string; readonly title: string | null };

      expect(createdConversation.title).toBeNull();
      conversationId = createdConversation.id;

      const userContent = "Reply with a short greeting.";
      const formData = new FormData();
      formData.set("type", "user");
      formData.set("content", userContent);

      const appendResponse = await fetch(`${BASE_URL}/conversations/${conversationId}/add-to-conv`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: formData,
      });

      expect(appendResponse.status).toBe(204);
      expect(await appendResponse.text()).toBe("");

      await waitForAssistantReply(conversationId);

      const page = await fetchPage(conversationId, 1, 50);
      const userMessage = page.items.find((item) => item.type === "user");
      const assistantMessage = page.items.find((item) => item.type === "assistant");

      expect(userMessage).toBeDefined();
      expect(userMessage?.content).toBe(userContent);
      expect(userMessage?.sequenceNumber).toBe(1);

      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.content.length).toBeGreaterThan(0);
      expect(assistantMessage?.sequenceNumber ?? 0).toBeGreaterThan(1);
    } finally {
      if (conversationId) {
        await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      }
    }
  });
});

function buildImageMessageFormData(imageBytes: ArrayBuffer, content: string): FormData {
  const formData = new FormData();
  formData.set("type", "user");
  formData.set("content", content);
  formData.set("file", new Blob([imageBytes], { type: "image/jpeg" }), "lambo.jpg");

  return formData;
}

async function fetchPage(conversationId: string, pageNum: number, pageSize: number): Promise<MessagePage> {
  const response = await fetch(`${BASE_URL}/conversations/${conversationId}/chat?pageNum=${pageNum}&pageSize=${pageSize}`, { headers: AUTH_HEADERS });

  expect(response.status).toBe(200);

  return (await response.json()) as MessagePage;
}

async function waitForAssistantReply(conversationId: string): Promise<void> {
  const deadline = Date.now() + COMPLETION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const page = await fetchPage(conversationId, 1, 50);

    if (page.items.some((item) => item.type === "assistant")) {
      return;
    }

    await new Promise((resolveSleep) => setTimeout(resolveSleep, COMPLETION_POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for assistant reply on conversation ${conversationId}.`);
}

function assertUserMessages(items: ReadonlyArray<MessageItem>, conversationId: string, startSequence: number, imageSize: number): void {
  for (let index = 0; index < items.length; index += 1) {
    const expectedSequence = startSequence + index;
    const item = items[index];

    expect(item.conversationId).toBe(conversationId);
    expect(item.sequenceNumber).toBe(expectedSequence);
    expect(item.type).toBe("user");
    expect(item.content).toBe(`Manual lambo image upload ${expectedSequence}`);
    expect(item.files).toHaveLength(1);
    expect(item.files[0]).toMatchObject({
      filename: "lambo.jpg",
      mimeType: "image/jpeg",
      sizeInBytes: imageSize,
    });
  }
}
