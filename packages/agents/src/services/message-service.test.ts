import { describe, expect, mock, test } from "bun:test";
import type { Message } from "@thoth/entities";
import type { MessageRepository } from "@thoth/contracts";
import { MessageService } from "./message-service";

describe("MessageService", () => {
  test("creates a message with zero files and server-owned timestamps", async () => {
    const messageRepository: MessageRepository = {
      async create(message: Message): Promise<Message> {
        return message;
      },
      getById: mock(async () => null),
      listByConversationId: mock(async () => []),
      listByConversationIds: mock(async () => new Map()),
      delete: mock(async () => undefined),
      deleteById: mock(async () => undefined),
    };
    const fileService = {
      storeFilesForMessage: mock(async () => []),
      deleteFiles: mock(async () => undefined),
    };
    const service = new MessageService(
      messageRepository,
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
    const messageRepository: MessageRepository = {
      async create(message: Message): Promise<Message> {
        return message;
      },
      getById: mock(async () => null),
      listByConversationId: mock(async () => []),
      listByConversationIds: mock(async () => new Map()),
      delete: mock(async () => undefined),
      deleteById: mock(async () => undefined),
    };
    const fileService = {
      storeFilesForMessage: mock(async () => {
        throw new Error("upload failed");
      }),
      deleteFiles: mock(async () => undefined),
    };
    const service = new MessageService(
      messageRepository,
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

    expect(messageRepository.deleteById).toHaveBeenCalledWith(
      "message-2",
    );
  });
});
