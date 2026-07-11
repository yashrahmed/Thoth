import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres from "postgres";

const BASE_URL = process.env.CONV_AGENT_URL ?? "http://127.0.0.1:3001";
const DATABASE_URL = process.env.SYSTEM_TEST_DATABASE_URL;
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;
const DECIMAL_BIGINT_PATTERN = /^[1-9][0-9]*$/u;
const AUTH_HEADERS: Record<string, string> =
  CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET
    ? {
        "cf-access-client-id": CF_ACCESS_CLIENT_ID,
        "cf-access-client-secret": CF_ACCESS_CLIENT_SECRET,
      }
    : {};

if (!DATABASE_URL) {
  throw new Error("SYSTEM_TEST_DATABASE_URL is required for message ID migration system tests.");
}

const sql = postgres(DATABASE_URL, { max: 2 });

interface MessageResponse {
  readonly id: string;
  readonly files: ReadonlyArray<{ readonly id: string }>;
}

describe("message bigint ID migration", () => {
  beforeAll(async () => {
    const response = await fetch(`${BASE_URL}/health`, { headers: AUTH_HEADERS });
    expect(response.status).toBe(200);
  });

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  test("round-trips bigint IDs, rejects legacy UUIDs, and cascades every association", async () => {
    let conversationId: string | undefined;

    try {
      const createResponse = await fetch(`${BASE_URL}/conversations`, { method: "POST", headers: AUTH_HEADERS });
      expect(createResponse.status).toBe(201);
      conversationId = ((await createResponse.json()) as { readonly id: string }).id;

      const appendResponses = await Promise.all(
        Array.from({ length: 20 }, (_, index) => appendMessage(conversationId as string, `Concurrent migration message ${index + 1}`, index === 0)),
      );

      for (const response of appendResponses) {
        expect(response.status).toBe(201);
      }

      const appendedMessages = (await Promise.all(appendResponses.map((response) => response.json()))) as MessageResponse[];
      const messageIds = appendedMessages.map((message) => message.id);

      expect(messageIds.every((id) => DECIMAL_BIGINT_PATTERN.test(id))).toBe(true);
      expect(new Set(messageIds).size).toBe(messageIds.length);
      expect(messageIds.every((id) => BigInt(id) <= 9_223_372_036_854_775_807n)).toBe(true);
      expect(appendedMessages[0]?.files).toHaveLength(1);

      const pageResponse = await fetch(`${BASE_URL}/conversations/${conversationId}/chat?pageNum=1&pageSize=50`, { headers: AUTH_HEADERS });
      expect(pageResponse.status).toBe(200);
      const page = (await pageResponse.json()) as { readonly items: ReadonlyArray<MessageResponse> };

      expect([...page.items.map((message) => message.id)].sort()).toEqual([...messageIds].sort());

      const firstMessageId = messageIds[0];
      expect(firstMessageId).toBeDefined();
      expect(page.items.find((message) => message.id === firstMessageId)?.files).toHaveLength(1);
      const completionMessageId = messageIds[1];
      expect(completionMessageId).toBeDefined();
      const duplicateResponse = await requestCompletion(conversationId, [completionMessageId as string, completionMessageId as string]);
      expect(duplicateResponse.status).toBe(400);
      expect(await duplicateResponse.json()).toMatchObject({
        error: { kind: "ValidationError", fieldName: "messageIds" },
      });

      const legacyCompletionResponse = await requestCompletion(conversationId, ["4f3de38e-3226-40f2-a7d8-958cc82a4c55"]);
      expect(legacyCompletionResponse.status).toBe(400);
      expect(await legacyCompletionResponse.json()).toMatchObject({
        error: { kind: "ValidationError", fieldName: "messageIds" },
      });

      const [linkedFileCount] = await sql<{ count: number }[]>`
        select count(*)::integer as count
        from thoth.files
        where message_id_bigint = ${firstMessageId as string}
      `;
      expect(linkedFileCount?.count).toBe(1);

      const deleteResponse = await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      expect(deleteResponse.status).toBe(204);
      const deletedConversationId = conversationId;
      conversationId = undefined;

      const [remaining] = await sql<{ messages: number; files: number }[]>`
        select
          (select count(*)::integer from thoth.messages where conversation_id = ${deletedConversationId}) as messages,
          (select count(*)::integer from thoth.files where message_id_bigint = any(${messageIds}::bigint[])) as files
      `;

      expect(remaining).toEqual({ messages: 0, files: 0 });
    } finally {
      if (conversationId) {
        await fetch(`${BASE_URL}/conversations/${conversationId}`, { method: "DELETE", headers: AUTH_HEADERS });
      }
    }
  });
});

function appendMessage(conversationId: string, content: string, withFile: boolean): Promise<Response> {
  const formData = new FormData();
  formData.set("type", "user");
  formData.set("content", content);

  if (withFile) {
    formData.set("attachment", new Blob(["migration-file"], { type: "text/plain" }), "migration.txt");
  }

  return fetch(`${BASE_URL}/conversations/${conversationId}/append-direct`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: formData,
  });
}

function requestCompletion(conversationId: string, messageIds: ReadonlyArray<string>): Promise<Response> {
  return fetch(`${BASE_URL}/conversations/${conversationId}/request-completion`, {
    method: "POST",
    headers: {
      ...AUTH_HEADERS,
      "content-type": "application/json",
    },
    body: JSON.stringify({ messageIds }),
  });
}
