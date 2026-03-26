import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "bun:test";
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
        expect(firstPage.items[index]?.fileIds).toEqual([expect.any(String)]);
        expect(firstPage.items[index]?.files).toHaveLength(1);
        expect(firstPage.items[index]?.files[0]).toMatchObject({
          filename: "lambo.jpg",
          mimeType: "image/jpeg",
          sizeInBytes: imageBytes.byteLength,
        });
      } else {
        expect(firstPage.items[index]?.fileIds).toEqual([]);
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
        expect(secondPage.items[index]?.fileIds).toEqual([expect.any(String)]);
        expect(secondPage.items[index]?.files).toHaveLength(1);
        expect(secondPage.items[index]?.files[0]).toMatchObject({
          filename: "lambo.jpg",
          mimeType: "image/jpeg",
          sizeInBytes: imageBytes.byteLength,
        });
      } else {
        expect(secondPage.items[index]?.fileIds).toEqual([]);
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
