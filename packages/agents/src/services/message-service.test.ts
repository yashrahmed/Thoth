import { describe, expect, mock, test } from "bun:test";
import type { Message } from "@thoth/entities";
import { MessageService } from "./message-service";

describe("MessageService", () => {
  test("creates a message with zero files and server-owned timestamps", async () => {
    const messageRepository = {
      async createMessage(message: Message): Promise<Message> {
        return message;
      },
      getMessageById: mock(async () => null),
      listMessagesByConversationId: mock(async () => []),
      deleteMessage: mock(async () => undefined),
      deleteMessageById: mock(async () => undefined),
    };
    const fileService = {
      storeFilesForMessage: mock(async () => []),
      deleteFiles: mock(async () => undefined),
    };
    const service = new MessageService(
      messageRepository as never,
      fileService as never,
    );

    const result = await service.createMessage({
      message: {
        id: "message-1",
        conversation_id: "conversation-1",
        type: "user",
        text_content: "hello",
      },
      files: [],
    });

    expect(result.last_create_ts).toBeInstanceOf(Date);
    expect(result.last_update_ts).toBeInstanceOf(Date);
    expect(result.files).toEqual([]);
  });

  test("deletes the message row when file storage fails after insert", async () => {
    const messageRepository = {
      async createMessage(message: Message): Promise<Message> {
        return message;
      },
      getMessageById: mock(async () => null),
      listMessagesByConversationId: mock(async () => []),
      deleteMessage: mock(async () => undefined),
      deleteMessageById: mock(async () => undefined),
    };
    const fileService = {
      storeFilesForMessage: mock(async () => {
        throw new Error("upload failed");
      }),
      deleteFiles: mock(async () => undefined),
    };
    const service = new MessageService(
      messageRepository as never,
      fileService as never,
    );

    await expect(
      service.createMessage({
        message: {
          id: "message-2",
          conversation_id: "conversation-1",
          type: "user",
          text_content: "hello",
        },
        files: [],
      }),
    ).rejects.toThrow("upload failed");

    expect(messageRepository.deleteMessageById).toHaveBeenCalledWith(
      "message-2",
    );
  });
});
