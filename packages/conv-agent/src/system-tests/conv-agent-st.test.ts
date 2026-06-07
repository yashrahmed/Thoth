import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "bun:test";

const BASE_URL = process.env.CONV_AGENT_URL ?? "http://127.0.0.1:3001";
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;
const IMAGE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "resources/lambo.jpg");
const COMPLETION_TIMEOUT_MS = 30_000;
const COMPLETION_POLL_INTERVAL_MS = 200;

// Dev: send the Access service-token headers so Cloudflare Access mints a JWT
// and forwards it to conv-agent.
// Local: no Access in front, no JWT enforcement, no headers needed.
const AUTH_HEADERS: Record<string, string> =
  CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET
    ? {
        "cf-access-client-id": CF_ACCESS_CLIENT_ID,
        "cf-access-client-secret": CF_ACCESS_CLIENT_SECRET,
      }
    : {};

type MessageType = "user" | "assistant" | "system" | "tool";

interface MessageItem {
  readonly id: string;
  readonly conversationId: string;
  readonly parentMessageId: string | null;
  readonly type: MessageType;
  readonly sequenceNumber: number;
  readonly childCount: number;
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
    const response = await fetch(`${BASE_URL}/health`, { headers: AUTH_HEADERS });

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

      let parentMessageId: string | null = null;

      for (let index = 1; index <= 10; index += 1) {
        const appendResponse = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: buildImageMessageFormData(imageBytes, `Manual lambo image upload ${index}`, {
            parentMessageId,
            appendPosition: 1,
          }),
        });

        expect(appendResponse.status).toBe(201);

        const appendedMessage = (await appendResponse.json()) as MessageItem;

        expect(appendedMessage.conversationId).toBe(conversationId);
        expect(appendedMessage.parentMessageId).toBe(parentMessageId);
        expect(appendedMessage.childCount).toBe(0);
        expect("path" in appendedMessage).toBe(false);
        expect(appendedMessage.files).toHaveLength(1);

        parentMessageId = appendedMessage.id;
      }

      const firstPage = await fetchPage(conversationId, 1, 4);

      expect(firstPage.items).toHaveLength(4);
      expect(firstPage.pageNum).toBe(1);
      expect(firstPage.pageSize).toBe(4);
      assertUserMessages(firstPage.items, conversationId, 1, imageBytes.byteLength, 10);

      const secondPage = await fetchPage(conversationId, 2, 4);

      expect(secondPage.items).toHaveLength(4);
      expect(secondPage.pageNum).toBe(2);
      expect(secondPage.pageSize).toBe(4);
      assertUserMessages(secondPage.items, conversationId, 5, imageBytes.byteLength, 10);

      const thirdPage = await fetchPage(conversationId, 3, 4);

      expect(thirdPage.items).toHaveLength(2);
      expect(thirdPage.pageNum).toBe(3);
      expect(thirdPage.pageSize).toBe(4);
      assertUserMessages(thirdPage.items, conversationId, 9, imageBytes.byteLength, 10);

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

  test("appends direct children and rejects an occupied child position", async () => {
    let conversationId: string | undefined;

    try {
      const createResponse = await fetch(`${BASE_URL}/conversations`, { method: "POST", headers: AUTH_HEADERS });
      expect(createResponse.status).toBe(201);
      conversationId = ((await createResponse.json()) as { readonly id: string }).id;

      const parentContent = "Direct append parent";
      const parentAppend = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: buildUserMessageFormData(parentContent, { appendPosition: 1 }),
      });

      expect(parentAppend.status).toBe(201);

      const parentMessage = (await parentAppend.json()) as MessageItem;

      expect(parentMessage.content).toBe(parentContent);
      expect(parentMessage.parentMessageId).toBeNull();

      const appendedChildren: MessageItem[] = [];

      for (let appendPosition = 1; appendPosition <= 3; appendPosition += 1) {
        const childAppend = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: buildUserMessageFormData(`Direct child ${appendPosition}`, {
            parentMessageId: parentMessage.id,
            appendPosition,
          }),
        });

        expect(childAppend.status).toBe(201);

        const childMessage = (await childAppend.json()) as MessageItem;

        expect(childMessage.content).toBe(`Direct child ${appendPosition}`);
        expect(childMessage.parentMessageId).toBe(parentMessage.id);
        expect(childMessage.childCount).toBe(0);
        expect("path" in childMessage).toBe(false);

        appendedChildren.push(childMessage);
      }

      const duplicateAppend = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: buildUserMessageFormData("Duplicate direct child", {
          parentMessageId: parentMessage.id,
          appendPosition: 3,
        }),
      });

      expect(duplicateAppend.status).toBe(400);

      const duplicateBody = (await duplicateAppend.json()) as { readonly error: { readonly kind: string; readonly fieldName: string } };

      expect(duplicateBody.error.kind).toBe("ValidationError");
      expect(duplicateBody.error.fieldName).toBe("appendPosition");

      const page = await fetchPage(conversationId, 1, 10);
      const updatedParentMessage = page.items.find((item) => item.id === parentMessage.id);

      expect(updatedParentMessage?.childCount).toBe(3);
      expect(appendedChildren).toHaveLength(3);
    } finally {
      if (conversationId) {
        await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      }
    }
  });

  test("add-to-conv appends from the selected parent and completion becomes a child of the input", async () => {
    let conversationId: string | undefined;

    try {
      const createResponse = await fetch(`${BASE_URL}/conversations`, { method: "POST", headers: AUTH_HEADERS });
      expect(createResponse.status).toBe(201);
      conversationId = ((await createResponse.json()) as { readonly id: string }).id;

      const parentContent = "Branch completion parent";
      const parentAppend = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: buildUserMessageFormData(parentContent, { appendPosition: 1 }),
      });

      expect(parentAppend.status).toBe(201);

      const parentMessage = (await parentAppend.json()) as MessageItem;

      expect(parentMessage.content).toBe(parentContent);

      const directChildAppend = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: buildUserMessageFormData("Existing direct child", {
          parentMessageId: parentMessage.id,
          appendPosition: 1,
        }),
      });

      expect(directChildAppend.status).toBe(201);

      const addToConvContent = "Reply with a short greeting for this branch.";
      const addToConvAppend = await fetch(`${BASE_URL}/conversations/${conversationId}/add-to-conv`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: buildUserMessageFormData(addToConvContent, {
          parentMessageId: parentMessage.id,
          appendPosition: 2,
        }),
      });

      expect(addToConvAppend.status).toBe(201);

      const appendedInput = (await addToConvAppend.json()) as MessageItem;

      expect(appendedInput.content).toBe(addToConvContent);
      expect(appendedInput.parentMessageId).toBe(parentMessage.id);
      expect(appendedInput.childCount).toBe(0);
      expect("path" in appendedInput).toBe(false);

      await waitForAssistantReply(conversationId);

      const page = await fetchPage(conversationId, 1, 50);
      const addToConvInput = page.items.find((item) => item.content === addToConvContent);

      expect(page.items.some((item) => item.type === "assistant")).toBe(true);
      expect(addToConvInput).toBeDefined();
      expect(addToConvInput?.childCount).toBe(1);
    } finally {
      if (conversationId) {
        await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      }
    }
  });

  test("appends to two conversations back-to-back and both receive completions", async () => {
    let firstConversationId: string | undefined;
    let secondConversationId: string | undefined;

    try {
      const firstCreate = await fetch(`${BASE_URL}/conversations`, { method: "POST", headers: AUTH_HEADERS });
      expect(firstCreate.status).toBe(201);
      firstConversationId = ((await firstCreate.json()) as { readonly id: string }).id;

      const firstAppend = await fetch(`${BASE_URL}/conversations/${firstConversationId}/add-to-conv`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: buildUserMessageFormData("Reply with a short greeting on conversation A.", { appendPosition: 1 }),
      });

      expect(firstAppend.status).toBe(201);

      // Immediately switch to a second conversation and append before A's completion lands.
      const secondCreate = await fetch(`${BASE_URL}/conversations`, { method: "POST", headers: AUTH_HEADERS });
      expect(secondCreate.status).toBe(201);
      secondConversationId = ((await secondCreate.json()) as { readonly id: string }).id;

      const secondAppend = await fetch(`${BASE_URL}/conversations/${secondConversationId}/add-to-conv`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: buildUserMessageFormData("Reply with a short greeting on conversation B.", { appendPosition: 1 }),
      });

      expect(secondAppend.status).toBe(201);

      // Both conversations must end up with an assistant reply.
      await waitForAssistantReply(secondConversationId);
      await waitForAssistantReply(firstConversationId);

      const firstPage = await fetchPage(firstConversationId, 1, 50);
      const secondPage = await fetchPage(secondConversationId, 1, 50);

      expect(firstPage.items.some((item) => item.type === "assistant")).toBe(true);
      expect(secondPage.items.some((item) => item.type === "assistant")).toBe(true);
    } finally {
      if (firstConversationId) {
        await fetch(`${BASE_URL}/conversations/${firstConversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      }
      if (secondConversationId) {
        await fetch(`${BASE_URL}/conversations/${secondConversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
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
      const formData = buildUserMessageFormData(userContent, { appendPosition: 1 });

      const appendResponse = await fetch(`${BASE_URL}/conversations/${conversationId}/add-to-conv`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: formData,
      });

      expect(appendResponse.status).toBe(201);

      const appendedUserMessage = (await appendResponse.json()) as MessageItem;

      expect(appendedUserMessage.content).toBe(userContent);
      expect(appendedUserMessage.parentMessageId).toBeNull();
      expect(appendedUserMessage.childCount).toBe(0);
      expect("path" in appendedUserMessage).toBe(false);

      await waitForAssistantReply(conversationId);

      const page = await fetchPage(conversationId, 1, 50);
      const userMessage = page.items.find((item) => item.type === "user");
      const assistantMessage = page.items.find((item) => item.type === "assistant");

      expect(userMessage).toBeDefined();
      expect(userMessage?.content).toBe(userContent);

      expect(assistantMessage).toBeDefined();
      expect(assistantMessage?.content.length).toBeGreaterThan(0);
    } finally {
      if (conversationId) {
        await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      }
    }
  });
});

function buildUserMessageFormData(content: string, options: { readonly parentMessageId?: string | null; readonly appendPosition: number }): FormData {
  const formData = new FormData();
  formData.set("type", "user");
  formData.set("content", content);
  formData.set("appendPosition", String(options.appendPosition));

  if (options.parentMessageId) {
    formData.set("parentMessageId", options.parentMessageId);
  }

  return formData;
}

function buildImageMessageFormData(imageBytes: ArrayBuffer, content: string, options: { readonly parentMessageId?: string | null; readonly appendPosition: number }): FormData {
  const formData = new FormData();
  formData.set("type", "user");
  formData.set("content", content);
  formData.set("appendPosition", String(options.appendPosition));

  if (options.parentMessageId) {
    formData.set("parentMessageId", options.parentMessageId);
  }

  formData.set("file", new Blob([imageBytes], { type: "image/jpeg" }), "lambo.jpg");

  return formData;
}

async function fetchPage(conversationId: string, pageNum: number, pageSize: number): Promise<MessagePage> {
  const response = await fetch(`${BASE_URL}/conversations/${conversationId}/chat?pageNum=${pageNum}&pageSize=${pageSize}`, { headers: AUTH_HEADERS });

  expect(response.status).toBe(200);

  return (await response.json()) as MessagePage;
}

// Polling can read the conversation many times before background completion
// lands. Validate bad HTTP responses without incrementing Bun's assertion
// count on every retry.
async function fetchPageForPolling(conversationId: string, pageNum: number, pageSize: number): Promise<MessagePage> {
  const response = await fetch(`${BASE_URL}/conversations/${conversationId}/chat?pageNum=${pageNum}&pageSize=${pageSize}`, { headers: AUTH_HEADERS });

  if (response.status !== 200) {
    throw new Error(`Expected conversation page fetch to return 200 while polling, received ${response.status}.`);
  }

  return (await response.json()) as MessagePage;
}

async function waitForAssistantReply(conversationId: string): Promise<void> {
  const deadline = Date.now() + COMPLETION_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const page = await fetchPageForPolling(conversationId, 1, 50);

    if (page.items.some((item) => item.type === "assistant")) {
      return;
    }

    await new Promise((resolveSleep) => setTimeout(resolveSleep, COMPLETION_POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for assistant reply on conversation ${conversationId}.`);
}

function assertUserMessages(items: ReadonlyArray<MessageItem>, conversationId: string, startSequence: number, imageSize: number, totalMessages: number): void {
  for (let index = 0; index < items.length; index += 1) {
    const expectedMessageIndex = startSequence + index;
    const item = items[index];

    expect(item.conversationId).toBe(conversationId);
    expect(item.childCount).toBe(expectedMessageIndex < totalMessages ? 1 : 0);
    expect("path" in item).toBe(false);
    expect(item.type).toBe("user");
    expect(item.content).toBe(`Manual lambo image upload ${expectedMessageIndex}`);
    expect(item.files).toHaveLength(1);
    expect(item.files[0]).toMatchObject({
      filename: "lambo.jpg",
      mimeType: "image/jpeg",
      sizeInBytes: imageSize,
    });
  }
}
