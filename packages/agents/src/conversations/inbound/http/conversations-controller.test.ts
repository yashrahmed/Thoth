import { describe, expect, test } from "bun:test";
import type {
  ConversationDto,
  ConversationsApplicationService,
  CreateConversationCommand,
  DeleteConversationCommand,
  DeleteMessageCommand,
  MessageDto,
  PostMessageCommand,
} from "@thoth/contracts";
import { ConversationsController } from "./conversations-controller";

class FakeConversationsService implements ConversationsApplicationService {
  public lastCreateCommand: CreateConversationCommand | null = null;
  public lastPostMessageCommand: PostMessageCommand | null = null;

  public async createConversation(
    input: CreateConversationCommand,
  ): Promise<ConversationDto> {
    this.lastCreateCommand = input;

    return buildConversationDto(input.conversationId ?? "conversation-1");
  }

  public async getConversationById(
    conversationId: string,
  ): Promise<ConversationDto | null> {
    return buildConversationDto(conversationId);
  }

  public async listConversations(): Promise<ConversationDto[]> {
    return [buildConversationDto("conversation-1")];
  }

  public async postMessage(input: PostMessageCommand): Promise<MessageDto> {
    this.lastPostMessageCommand = input;

    return buildConversationDto(input.conversationId).messages[0]!;
  }

  public async deleteConversation(_input: DeleteConversationCommand): Promise<void> {}

  public async deleteMessage(_input: DeleteMessageCommand): Promise<void> {}
}

describe("ConversationsController", () => {
  test("creates a conversation from JSON", async () => {
    const service = new FakeConversationsService();
    const controller = new ConversationsController(service);
    const response = await controller.handle(
      new Request("http://localhost/conversations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ conversationId: "conversation-9" }),
      }),
    );

    expect(response.status).toBe(201);
    expect(service.lastCreateCommand).toEqual({ conversationId: "conversation-9" });
  });

  test("creates a message from multipart form-data", async () => {
    const service = new FakeConversationsService();
    const controller = new ConversationsController(service);
    const formData = new FormData();

    formData.set(
      "message",
      JSON.stringify({
        role: "user",
        textContent: "hello",
      }),
    );
    formData.append(
      "files",
      new File(["payload"], "payload.txt", { type: "text/plain" }),
    );

    const response = await controller.handle(
      new Request("http://localhost/conversations/conversation-1/messages", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(service.lastPostMessageCommand?.conversationId).toBe("conversation-1");
    expect(service.lastPostMessageCommand?.attachments).toHaveLength(1);
  });

  test("rejects invalid JSON requests", async () => {
    const controller = new ConversationsController(new FakeConversationsService());
    const response = await controller.handle(
      new Request("http://localhost/conversations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: "not-json",
      }),
    );

    expect(response.status).toBe(400);
  });
});

function buildConversationDto(conversationId: string): ConversationDto {
  return {
    id: conversationId,
    createdAt: "2026-03-11T18:00:00.000Z",
    updatedAt: "2026-03-11T18:05:00.000Z",
    messages: [
      {
        id: "message-1",
        role: "user",
        textContent: "hello",
        createdAt: "2026-03-11T18:05:00.000Z",
        updatedAt: "2026-03-11T18:05:00.000Z",
        attachments: [],
      },
    ],
  };
}
