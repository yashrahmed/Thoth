import { describe, expect, test } from "bun:test";
import type {
  ConversationQuery,
  CreateConversationQuery,
  DeleteConversationQuery,
  UpdateConversationQuery,
} from "@thoth/contracts";
import type { Conversation } from "@thoth/entities";
import { ConversationController } from "./conversation-controller";

class FakeConversationService implements ConversationQuery {
  public lastCreateQuery: CreateConversationQuery | null = null;
  public lastUpdateQuery: UpdateConversationQuery | null = null;

  async createConversation(
    input: CreateConversationQuery,
  ): Promise<Conversation> {
    this.lastCreateQuery = input;

    return this.buildConversation(input.conversation.id);
  }

  async getConversationById(
    conversationId: string,
  ): Promise<Conversation | null> {
    return this.buildConversation(conversationId);
  }

  async listConversations(): Promise<Conversation[]> {
    return [this.buildConversation("conversation-1")];
  }

  async updateConversation(
    input: UpdateConversationQuery,
  ): Promise<Conversation> {
    this.lastUpdateQuery = input;

    return this.buildConversation(input.conversation.id);
  }

  async deleteConversation(_input: DeleteConversationQuery): Promise<void> {}

  private buildConversation(conversationId: string): Conversation {
    return {
      id: conversationId,
      messages: [
        {
          id: "message-1",
          conversation_id: conversationId,
          type: "user",
          text_content: "hello",
          files: [
            {
              id: "file-1",
              object_key: "conversations/file-1.png",
              original_filename: "hello.png",
              byte_size: 4,
              last_create_ts: new Date("2026-03-10T12:00:00.000Z"),
            },
          ],
          last_create_ts: new Date("2026-03-10T12:00:00.000Z"),
          last_update_ts: new Date("2026-03-10T12:00:00.000Z"),
        },
      ],
      last_create_ts: new Date("2026-03-10T12:00:00.000Z"),
      last_update_ts: new Date("2026-03-10T12:00:00.000Z"),
    };
  }
}

describe("ConversationController", () => {
  test("ignores client timestamps on create and serializes nested files", async () => {
    const conversationService = new FakeConversationService();
    const controller = new ConversationController(conversationService);
    const response = await controller.insert(
      new Request("http://localhost/conversations", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          conversation: {
            id: "conversation-1",
            last_create_ts: "1999-01-01T00:00:00.000Z",
            last_update_ts: "1999-01-01T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(conversationService.lastCreateQuery).toEqual({
      conversation: {
        id: "conversation-1",
      },
    });

    const body = await response.json();

    expect(body.messages[0].files).toHaveLength(1);
    expect(body.messages[0].media_content).toBeUndefined();
  });

  test("ignores client timestamps on update", async () => {
    const conversationService = new FakeConversationService();
    const controller = new ConversationController(conversationService);
    const response = await controller.update(
      new Request("http://localhost/conversations", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          conversation: {
            id: "conversation-2",
            last_create_ts: "1999-01-01T00:00:00.000Z",
            last_update_ts: "1999-01-01T00:00:00.000Z",
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(conversationService.lastUpdateQuery).toEqual({
      conversation: {
        id: "conversation-2",
      },
    });
  });
});
