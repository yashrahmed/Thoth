import { describe, expect, test } from "bun:test";
import type { CreateMessageQuery, DeleteMessageQuery, MessageQuery } from "@thoth/contracts";
import type { Message } from "@thoth/entities";
import { MessageController } from "./message-controller";

class FakeMessageService implements MessageQuery {
  public lastCreateQuery: CreateMessageQuery | null = null;
  public lastDeleteQuery: DeleteMessageQuery | null = null;

  async createMessage(input: CreateMessageQuery): Promise<Message> {
    this.lastCreateQuery = input;

    return {
      id: input.message.id,
      conversation_id: input.message.conversation_id,
      type: input.message.type,
      text_content: input.message.text_content,
      files: input.files.map((file, index) => ({
        id: `file-${index + 1}`,
        object_key: `conversations/file-${index + 1}`,
        original_filename: file.original_filename,
        byte_size: file.byte_size,
        last_create_ts: new Date("2026-03-10T12:00:00.000Z"),
      })),
      last_create_ts: new Date("2026-03-10T12:00:00.000Z"),
      last_update_ts: new Date("2026-03-10T12:00:00.000Z"),
    };
  }

  async getMessageById(): Promise<Message | null> {
    return null;
  }

  async listMessagesByConversationId(): Promise<Message[]> {
    return [];
  }

  async deleteMessage(input: DeleteMessageQuery): Promise<void> {
    this.lastDeleteQuery = input;
  }
}

describe("MessageController", () => {
  test("creates a text-only message from multipart form-data with zero files", async () => {
    const messageService = new FakeMessageService();
    const controller = new MessageController(messageService);
    const formData = new FormData();

    formData.set(
      "message",
      JSON.stringify({
        id: "message-1",
        conversation_id: "conversation-1",
        type: "user",
        text_content: "hello",
      }),
    );

    const response = await controller.insert(
      new Request("http://localhost/messages", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(messageService.lastCreateQuery).not.toBeNull();
    expect(messageService.lastCreateQuery?.files).toEqual([]);

    const body = await response.json();

    expect(body.files).toEqual([]);
    expect(body.media_content).toBeUndefined();
  });

  test("creates a message from multipart form-data with multiple files", async () => {
    const messageService = new FakeMessageService();
    const controller = new MessageController(messageService);
    const formData = new FormData();

    formData.set(
      "message",
      JSON.stringify({
        id: "message-2",
        conversation_id: "conversation-1",
        type: "user",
        text_content: "files",
      }),
    );
    formData.append(
      "files",
      new File(["alpha"], "alpha.txt", { type: "text/plain" }),
    );
    formData.append(
      "files",
      new File(["beta"], "beta.png", { type: "image/png" }),
    );

    const response = await controller.insert(
      new Request("http://localhost/messages", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(messageService.lastCreateQuery?.files).toHaveLength(2);
    expect(messageService.lastCreateQuery?.files[0]?.original_filename).toBe(
      "alpha.txt",
    );
    expect(messageService.lastCreateQuery?.files[1]?.content_type).toBe(
      "image/png",
    );

    const body = await response.json();

    expect(body.files).toHaveLength(2);
    expect(body.files[1].original_filename).toBe("beta.png");
  });

  test("rejects non-multipart message creation requests", async () => {
    const controller = new MessageController(new FakeMessageService());
    const response = await controller.insert(
      new Request("http://localhost/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Request body must be multipart/form-data.",
    });
  });
});
