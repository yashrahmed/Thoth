import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { failure, success } from "../../domain/objects/result";
import { EntityType, LlmError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { LLMMessageType } from "../../domain/objects/llm";
import { createConversationHttpHandler } from "./conversation-http-handler";

describe("createConversationHttpHandler", () => {
  afterEach(() => {
    mock.restore();
  });

  test("returns a generic 500 response for application errors", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createConversationHttpHandler(
      buildDeps({
        createConversation: {
          execute: async () => failure(new StoreError(EntityType.Conversation, StoreOperation.Persist, "password authentication failed for user thoth")),
        },
      }),
    );

    const response = await handler(new Request("http://localhost/conversations", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        kind: "UnexpectedError",
        message: "An unexpected error occurred.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("password authentication failed");
    expect(errorSpy).toHaveBeenCalled();
  });

  test("returns a generic 500 response for uncaught handler errors", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createConversationHttpHandler(
      buildDeps({
        createConversation: {
          execute: async () => {
            throw new Error("relation conversations does not exist");
          },
        },
      }),
    );

    const response = await handler(new Request("http://localhost/conversations", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        kind: "UnexpectedError",
        message: "An unexpected error occurred.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("relation conversations");
    expect(errorSpy).toHaveBeenCalled();
  });

  test("returns the completion messages without appending them", async () => {
    const execute = mock(async () => success([{ type: LLMMessageType.Assistant, content: "Hello there." }]));
    const handler = createConversationHttpHandler(buildDeps({ requestCompletion: { execute } }));

    const response = await handler(
      new Request("http://localhost/conversations/conversation-1/request-completion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: "message-1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      messages: [{ type: "assistant", content: "Hello there." }],
    });
    expect(execute).toHaveBeenCalledWith({ conversationId: "conversation-1", messageId: "message-1" });
  });

  test("returns a generic 502 response when the completion fails at the LLM", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createConversationHttpHandler(
      buildDeps({
        requestCompletion: {
          execute: async () => failure(new LlmError("provider secret detail leaked here", "timeout")),
        },
      }),
    );

    const response = await handler(
      new Request("http://localhost/conversations/conversation-1/request-completion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: "message-1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: {
        kind: "LlmError",
        code: "timeout",
        message: "The assistant timed out while generating a reply. Please try again.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("provider secret detail");
    expect(errorSpy).toHaveBeenCalled();
  });
});

function buildDeps(overrides: Record<string, unknown> = {}) {
  return {
    accessVerification: null,
    accessIdentityAuthorizer: null,
    accessTeamDomain: null,
    createConversation: unusedFlow("createConversation"),
    getConversation: unusedFlow("getConversation"),
    listConversations: unusedFlow("listConversations"),
    updateConv: unusedFlow("updateConv"),
    deleteConversation: unusedFlow("deleteConversation"),
    appendMessage: unusedFlow("appendMessage"),
    requestCompletion: unusedFlow("requestCompletion"),
    getMessagesOnConversation: unusedFlow("getMessagesOnConversation"),
    ...overrides,
  } as unknown as Parameters<typeof createConversationHttpHandler>[0];
}

function unusedFlow(name: string) {
  return {
    execute: async () => {
      throw new Error(`${name} should not be called.`);
    },
  };
}
