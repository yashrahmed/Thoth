import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, test } from "bun:test";

const BASE_URL = process.env.CONV_AGENT_URL ?? "http://127.0.0.1:3001";
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;
const IMAGE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "resources/lambo.jpg");

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

interface CompletionResponseBody {
  readonly messages: ReadonlyArray<{ readonly type: MessageType; readonly content: string }>;
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
        assertInternalMessageFieldsHidden(appendedMessage);
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
        assertInternalMessageFieldsHidden(childMessage);

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

  test("returns a completion for the selected branch input that the client appends", async () => {
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

      const branchInputContent = "Reply with a short greeting for this branch.";
      const branchAppend = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: buildUserMessageFormData(branchInputContent, {
          parentMessageId: parentMessage.id,
          appendPosition: 2,
        }),
      });

      expect(branchAppend.status).toBe(201);

      const appendedInput = (await branchAppend.json()) as MessageItem;

      expect(appendedInput.content).toBe(branchInputContent);
      expect(appendedInput.parentMessageId).toBe(parentMessage.id);
      expect(appendedInput.childCount).toBe(0);
      assertInternalMessageFieldsHidden(appendedInput);

      const completionResponse = await requestCompletion(conversationId, appendedInput.id);

      expect(completionResponse.status).toBe(200);

      const completion = (await completionResponse.json()) as CompletionResponseBody;

      expect(completion.messages.length).toBeGreaterThan(0);
      expect(completion.messages[0]?.type).toBe("assistant");

      // The completion is not persisted by the service: appending the reply at
      // position 1 below only succeeds because the slot is still empty.
      await appendCompletionMessages(conversationId, appendedInput.id, completion.messages);

      const page = await fetchPage(conversationId, 1, 50);
      const branchInput = page.items.find((item) => item.content === branchInputContent);

      expect(page.items.some((item) => item.type === "assistant")).toBe(true);
      expect(branchInput).toBeDefined();
      expect(branchInput?.childCount).toBe(1);
    } finally {
      if (conversationId) {
        await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      }
    }
  });

  test("duplicate completion appends for the same position collapse onto one reply", async () => {
    let conversationId: string | undefined;

    try {
      const createResponse = await fetch(`${BASE_URL}/conversations`, { method: "POST", headers: AUTH_HEADERS });
      expect(createResponse.status).toBe(201);
      conversationId = ((await createResponse.json()) as { readonly id: string }).id;

      const userContent = "Reply with a short greeting, please.";
      const appendResponse = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: buildUserMessageFormData(userContent, { appendPosition: 1 }),
      });

      expect(appendResponse.status).toBe(201);

      const userMessage = (await appendResponse.json()) as MessageItem;

      // Completions are side-effect free, so requesting twice simply yields
      // two candidate replies.
      const [firstCompletion, secondCompletion] = await Promise.all([requestCompletion(conversationId, userMessage.id), requestCompletion(conversationId, userMessage.id)]);

      expect(firstCompletion.status).toBe(200);
      expect(secondCompletion.status).toBe(200);

      const firstBody = (await firstCompletion.json()) as CompletionResponseBody;
      const secondBody = (await secondCompletion.json()) as CompletionResponseBody;

      expect(firstBody.messages.length).toBeGreaterThan(0);
      expect(secondBody.messages.length).toBeGreaterThan(0);

      // Idempotency now lives at the append step: both replies target position
      // 1 under the user message, and the store rejects the second append.
      const firstAppend = await appendMessage(conversationId, {
        type: "assistant",
        content: firstBody.messages[0]?.content ?? "",
        parentMessageId: userMessage.id,
        appendPosition: 1,
      });

      expect(firstAppend.status).toBe(201);

      const secondAppend = await appendMessage(conversationId, {
        type: "assistant",
        content: secondBody.messages[0]?.content ?? "",
        parentMessageId: userMessage.id,
        appendPosition: 1,
      });

      expect(secondAppend.status).toBe(400);

      const secondAppendBody = (await secondAppend.json()) as { readonly error: { readonly kind: string; readonly fieldName: string } };

      expect(secondAppendBody.error.kind).toBe("ValidationError");
      expect(secondAppendBody.error.fieldName).toBe("appendPosition");

      const page = await fetchPage(conversationId, 1, 50);
      const updatedUserMessage = page.items.find((item) => item.id === userMessage.id);

      expect(updatedUserMessage?.childCount).toBe(1);
    } finally {
      if (conversationId) {
        await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      }
    }
  });

  test("rejects a completion request whose parent is not a user message", async () => {
    let conversationId: string | undefined;

    try {
      const createResponse = await fetch(`${BASE_URL}/conversations`, { method: "POST", headers: AUTH_HEADERS });
      expect(createResponse.status).toBe(201);
      conversationId = ((await createResponse.json()) as { readonly id: string }).id;

      const rootAppend = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: buildUserMessageFormData("Root user message", { appendPosition: 1 }),
      });

      expect(rootAppend.status).toBe(201);

      const rootMessage = (await rootAppend.json()) as MessageItem;

      const assistantFormData = new FormData();
      assistantFormData.set("type", "assistant");
      assistantFormData.set("content", "Manually appended assistant message");
      assistantFormData.set("appendPosition", "1");
      assistantFormData.set("parentMessageId", rootMessage.id);

      const assistantAppend = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: assistantFormData,
      });

      expect(assistantAppend.status).toBe(201);

      const assistantMessage = (await assistantAppend.json()) as MessageItem;
      const completionResponse = await requestCompletion(conversationId, assistantMessage.id);

      expect(completionResponse.status).toBe(400);

      const completionBody = (await completionResponse.json()) as { readonly error: { readonly kind: string; readonly fieldName: string } };

      expect(completionBody.error.kind).toBe("ValidationError");
      expect(completionBody.error.fieldName).toBe("parentMessageId");
    } finally {
      if (conversationId) {
        await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      }
    }
  });

  test("posts a single user message, requests a completion, and appends the assistant reply", async () => {
    let conversationId: string | undefined;

    try {
      const createResponse = await fetch(`${BASE_URL}/conversations`, { method: "POST", headers: AUTH_HEADERS });

      expect(createResponse.status).toBe(201);

      const createdConversation = (await createResponse.json()) as { readonly id: string; readonly title: string | null };

      expect(createdConversation.title).toBeNull();
      conversationId = createdConversation.id;

      const userContent = "Reply with a short greeting.";
      const formData = buildUserMessageFormData(userContent, { appendPosition: 1 });

      const appendResponse = await fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: formData,
      });

      expect(appendResponse.status).toBe(201);

      const appendedUserMessage = (await appendResponse.json()) as MessageItem;

      expect(appendedUserMessage.content).toBe(userContent);
      expect(appendedUserMessage.parentMessageId).toBeNull();
      expect(appendedUserMessage.childCount).toBe(0);
      assertInternalMessageFieldsHidden(appendedUserMessage);

      const completionResponse = await requestCompletion(conversationId, appendedUserMessage.id);

      expect(completionResponse.status).toBe(200);

      const completion = (await completionResponse.json()) as CompletionResponseBody;

      expect(completion.messages.length).toBeGreaterThan(0);
      expect(completion.messages[0]?.type).toBe("assistant");
      expect(completion.messages[0]?.content.length).toBeGreaterThan(0);

      await appendCompletionMessages(conversationId, appendedUserMessage.id, completion.messages);

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

function requestCompletion(conversationId: string, parentMessageId: string): Promise<Response> {
  return fetch(`${BASE_URL}/conversations/${conversationId}/request-completion`, {
    method: "POST",
    headers: {
      ...AUTH_HEADERS,
      "content-type": "application/json",
    },
    body: JSON.stringify({ parentMessageId }),
  });
}

function appendMessage(
  conversationId: string,
  message: { readonly type: MessageType; readonly content: string; readonly parentMessageId: string | null; readonly appendPosition: number },
): Promise<Response> {
  const formData = new FormData();
  formData.set("type", message.type);
  formData.set("content", message.content);
  formData.set("appendPosition", String(message.appendPosition));

  if (message.parentMessageId) {
    formData.set("parentMessageId", message.parentMessageId);
  }

  return fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: formData,
  });
}

// Appends the completion messages returned by /request-completion, chaining
// each message under the previous one starting from the parent message.
async function appendCompletionMessages(conversationId: string, parentMessageId: string, messages: CompletionResponseBody["messages"]): Promise<void> {
  let currentParentId = parentMessageId;

  for (const message of messages) {
    const appendResponse = await appendMessage(conversationId, {
      type: message.type,
      content: message.content,
      parentMessageId: currentParentId,
      appendPosition: 1,
    });

    expect(appendResponse.status).toBe(201);

    currentParentId = ((await appendResponse.json()) as MessageItem).id;
  }
}

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

function assertUserMessages(items: ReadonlyArray<MessageItem>, conversationId: string, startSequence: number, imageSize: number, totalMessages: number): void {
  for (let index = 0; index < items.length; index += 1) {
    const expectedMessageIndex = startSequence + index;
    const item = items[index];

    expect(item.conversationId).toBe(conversationId);
    expect(item.childCount).toBe(expectedMessageIndex < totalMessages ? 1 : 0);
    assertInternalMessageFieldsHidden(item);
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

function assertInternalMessageFieldsHidden(item: MessageItem): void {
  expect("path" in item).toBe(false);
  expect("sequenceNumber" in item).toBe(false);
}
