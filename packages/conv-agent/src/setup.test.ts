import { describe, expect, test } from "bun:test";
import { createConversationHttpHandler } from "./adapter/inbound/conversation-http-handler";
import type { BlobRepository } from "./domain/contracts/blob-repository";
import type {
  ConversationOffsetPageRequest,
  CreateConversationRecord,
  ConversationRepository,
} from "./domain/contracts/conversation-repository";
import type {
  CreateFileRecord,
  FileRepository,
} from "./domain/contracts/file-repository";
import type {
  CreateMessageRecord,
  MessageRepository,
  MessageSequencePageRequest,
} from "./domain/contracts/message-repository";
import { Conversation } from "./domain/objects/conversation";
import { File as StoredFile } from "./domain/objects/file";
import { NotFoundError, type StoreError } from "./domain/objects/errors";
import type { ContentPart, ToolCall } from "./domain/objects/message-content";
import { Message } from "./domain/objects/message";
import { failure, success, type Result } from "./domain/objects/result";
import { BlobDomainService } from "./domain/services/blob-domain-service";
import { ConversationDomainService } from "./domain/services/conversation-domain-service";
import { FileDomainService } from "./domain/services/file-domain-service";
import { MessageDomainService } from "./domain/services/message-domain-service";
import { AppendMessageToConversationFlow } from "./application/append-message-to-conversation-flow";
import { CreateConversationFlow } from "./application/create-conversation-flow";
import { DeleteConversationFlow } from "./application/delete-conversation-flow";
import { GetConversationFlow } from "./application/get-conversation-flow";
import { GetMessagesOnConversationFlow } from "./application/get-messages-on-conversation-flow";
import { ListConversationsFlow } from "./application/list-conversations-flow";

describe("createConversationHttpHandler", () => {
  test("returns a local health response", async () => {
    const handler = buildHandler();

    const response = await handler(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "conv-agent",
    });
  });

  test("creates, gets, and lists conversations", async () => {
    const repository = new InMemoryConversationRepository();
    repository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
      mustCreateConversation("conversation-2", "2026-03-16T13:00:00.000Z"),
    ]);
    const handler = buildHandler({ conversationRepository: repository });

    const createResponse = await handler(
      new Request("http://localhost/conversations", { method: "POST" }),
    );
    const getResponse = await handler(
      new Request("http://localhost/conversations/conversation-1"),
    );
    const listResponse = await handler(
      new Request("http://localhost/conversations?pageNum=1&pageSize=2"),
    );

    expect(createResponse.status).toBe(201);
    expect(await createResponse.json()).toEqual({
      id: "conversation-created",
      createdAt: "2026-03-16T12:00:00.000Z",
      updatedAt: "2026-03-16T12:00:00.000Z",
    });
    expect(getResponse.status).toBe(200);
    expect(await getResponse.json()).toEqual({
      id: "conversation-1",
      createdAt: "2026-03-16T12:00:00.000Z",
      updatedAt: "2026-03-16T12:00:00.000Z",
    });
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      items: [
        {
          id: "conversation-2",
          createdAt: "2026-03-16T13:00:00.000Z",
          updatedAt: "2026-03-16T13:00:00.000Z",
        },
        {
          id: "conversation-created",
          createdAt: "2026-03-16T12:00:00.000Z",
          updatedAt: "2026-03-16T12:00:00.000Z",
        },
      ],
      pageNum: 1,
      pageSize: 2,
    });
  });

  test("maps missing conversations to 404", async () => {
    const handler = buildHandler();

    const response = await handler(
      new Request("http://localhost/conversations/missing"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: new NotFoundError("Conversation", "missing"),
    });
  });

  test("appends a message with multipart rich-message fields", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    conversationRepository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
    ]);
    const handler = buildHandler({ conversationRepository });
    const formData = new FormData();

    formData.set("type", "assistant");
    formData.set("content", JSON.stringify([textPart("hello")]));
    formData.set("toolCalls", JSON.stringify([toolCall("tool-call-1", "search")]));
    formData.set("toolCallId", "tool-call-1");
    formData.set(
      "attachment",
      new globalThis.File(["hello"], "greeting.txt", { type: "text/plain" }),
    );

    const response = await handler(
      new Request("http://localhost/conversations/conversation-1/chat", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: "message-1",
      conversationId: "conversation-1",
      type: "assistant",
      sequenceNumber: 1,
      content: [textPart("hello")],
      toolCalls: [toolCall("tool-call-1", "search")],
      toolCallId: "tool-call-1",
      fileIds: ["file-1"],
      createdAt: "2026-03-16T12:00:00.000Z",
      updatedAt: "2026-03-16T12:00:00.000Z",
    });
  });

  test("rejects invalid rich-message payloads", async () => {
    const handler = buildHandler();

    const invalidJsonFormData = new FormData();
    invalidJsonFormData.set("type", "user");
    invalidJsonFormData.set("content", "{bad");

    const invalidJsonResponse = await handler(
      new Request("http://localhost/conversations/conversation-1/chat", {
        method: "POST",
        body: invalidJsonFormData,
      }),
    );

    expect(invalidJsonResponse.status).toBe(400);
    expect(await invalidJsonResponse.json()).toEqual({
      error: {
        kind: "ValidationError",
        fieldName: "content",
        message: "content must be valid JSON.",
      },
    });
  });

  test("lists messages for a conversation using the rich response shape", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    conversationRepository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
    ]);
    const messageRepository = new InMemoryMessageRepository();
    messageRepository.seed([
      mustCreateMessage(
        "message-1",
        "conversation-1",
        "user",
        1,
        [textPart("one")],
        [],
        "",
        ["file-1"],
        "2026-03-16T12:00:00.000Z",
      ),
      mustCreateMessage(
        "message-2",
        "conversation-1",
        "assistant",
        2,
        [textPart("two")],
        [toolCall("tool-call-2", "search")],
        "tool-call-2",
        [],
        "2026-03-16T12:01:00.000Z",
      ),
    ]);
    const fileRepository = new InMemoryFileRepository();
    fileRepository.seed([
      mustCreateFile(
        "file-1",
        "/conversations/conversation-1/file-1-one.txt",
        "one.txt",
        "text/plain",
        3,
        "2026-03-16T11:59:00.000Z",
      ),
    ]);
    const handler = buildHandler({
      conversationRepository,
      messageRepository,
      fileRepository,
    });

    const response = await handler(
      new Request(
        "http://localhost/conversations/conversation-1/chat?pageNum=1&pageSize=2",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: "message-1",
          conversationId: "conversation-1",
          type: "user",
          sequenceNumber: 1,
          content: [textPart("one")],
          toolCalls: [],
          toolCallId: "",
          files: [
            {
              id: "file-1",
              canonicalUrl: "/conversations/conversation-1/file-1-one.txt",
              filename: "one.txt",
              mimeType: "text/plain",
              sizeInBytes: 3,
              createdAt: "2026-03-16T11:59:00.000Z",
              updatedAt: "2026-03-16T11:59:00.000Z",
            },
          ],
          createdAt: "2026-03-16T12:00:00.000Z",
          updatedAt: "2026-03-16T12:00:00.000Z",
        },
        {
          id: "message-2",
          conversationId: "conversation-1",
          type: "assistant",
          sequenceNumber: 2,
          content: [textPart("two")],
          toolCalls: [toolCall("tool-call-2", "search")],
          toolCallId: "tool-call-2",
          files: [],
          createdAt: "2026-03-16T12:01:00.000Z",
          updatedAt: "2026-03-16T12:01:00.000Z",
        },
      ],
      pageNum: 1,
      pageSize: 2,
    });
  });

  test("deletes a conversation", async () => {
    const repository = new InMemoryConversationRepository();
    repository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
    ]);
    const handler = buildHandler({ conversationRepository: repository });

    const response = await handler(
      new Request("http://localhost/conversations/conversation-1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(204);
    expect(repository.deletedIds).toEqual(["conversation-1"]);
  });
});

function buildHandler(overrides?: {
  readonly conversationRepository?: InMemoryConversationRepository;
  readonly messageRepository?: InMemoryMessageRepository;
  readonly fileRepository?: InMemoryFileRepository;
  readonly blobRepository?: InMemoryBlobRepository;
}) {
  const conversationRepository =
    overrides?.conversationRepository ?? new InMemoryConversationRepository();
  const messageRepository =
    overrides?.messageRepository ?? new InMemoryMessageRepository();
  const fileRepository = overrides?.fileRepository ?? new InMemoryFileRepository();
  const blobRepository = overrides?.blobRepository ?? new InMemoryBlobRepository();
  const now = () => new Date("2026-03-16T12:00:00.000Z");
  const conversationDomainService = new ConversationDomainService(
    conversationRepository,
    now,
  );
  const blobDomainService = new BlobDomainService(blobRepository);
  const messageDomainService = new MessageDomainService(messageRepository, now);
  const fileDomainService = new FileDomainService(
    fileRepository,
    blobDomainService,
    now,
  );

  return createConversationHttpHandler(
    new CreateConversationFlow(conversationDomainService),
    new GetConversationFlow(conversationDomainService),
    new ListConversationsFlow(conversationDomainService),
    new DeleteConversationFlow(
      conversationDomainService,
      messageDomainService,
      fileDomainService,
    ),
    new AppendMessageToConversationFlow(
      conversationDomainService,
      messageDomainService,
      fileDomainService,
    ),
    new GetMessagesOnConversationFlow(
      conversationDomainService,
      messageDomainService,
      fileDomainService,
    ),
  );
}

class InMemoryConversationRepository implements ConversationRepository {
  readonly deletedIds: string[] = [];
  private readonly conversations = new Map<string, Conversation>();

  seed(conversations: Conversation[]): void {
    this.conversations.clear();

    for (const conversation of conversations) {
      this.conversations.set(conversation.id, conversation);
    }
  }

  async upsertConversationRow(
    record: CreateConversationRecord,
  ): Promise<Result<Conversation, StoreError>> {
    const conversation = mustCreateConversation(
      "conversation-created",
      record.createdAt.toISOString(),
    );
    this.conversations.set(conversation.id, conversation);
    return success(conversation);
  }

  async selectConversationRow(conversationId: string) {
    const conversation = this.conversations.get(conversationId);

    if (!conversation) {
      return failure(new NotFoundError("Conversation", conversationId));
    }

    return success(conversation);
  }

  async selectConversationPage(request: ConversationOffsetPageRequest) {
    const items = [...this.conversations.values()].sort((left, right) => {
      const updatedAtDelta = right.updatedAt.getTime() - left.updatedAt.getTime();

      if (updatedAtDelta !== 0) {
        return updatedAtDelta;
      }

      return right.id.localeCompare(left.id);
    });

    return success(items.slice(request.offset, request.offset + request.pageSize));
  }

  async deleteConversationRow(conversationId: string) {
    this.deletedIds.push(conversationId);
    this.conversations.delete(conversationId);
    return success(undefined);
  }
}

class InMemoryMessageRepository implements MessageRepository {
  private readonly messages = new Map<string, Message>();

  seed(messages: Message[]): void {
    this.messages.clear();

    for (const message of messages) {
      this.messages.set(message.id, message);
    }
  }

  async upsertMessageRow(record: CreateMessageRecord) {
    const message = mustCreateMessage(
      `message-${this.messages.size + 1}`,
      record.conversationId,
      record.type,
      record.sequenceNumber,
      record.content,
      record.toolCalls,
      record.toolCallId,
      record.fileIds,
      record.createdAt.toISOString(),
    );
    this.messages.set(message.id, message);
    return success(message);
  }

  async selectMessageRow(messageId: string) {
    const message = this.messages.get(messageId);

    if (!message) {
      return failure(new NotFoundError("Message", messageId));
    }

    return success(message);
  }

  async selectMessagePage(request: MessageSequencePageRequest) {
    return success(
      [...this.messages.values()]
        .filter(
          (message) =>
            message.conversationId === request.conversationId &&
            message.sequenceNumber >= request.fromSequence,
        )
        .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
        .slice(0, request.pageSize),
    );
  }

  async selectAllMessagesByConversation(conversationId: string) {
    return success(
      [...this.messages.values()].filter(
        (message) => message.conversationId === conversationId,
      ),
    );
  }

  async countMessagesByConversation(conversationId: string) {
    return success(
      [...this.messages.values()].filter(
        (message) => message.conversationId === conversationId,
      ).length,
    );
  }

  async deleteMessageRow(messageId: string) {
    this.messages.delete(messageId);
    return success(undefined);
  }
}

class InMemoryFileRepository implements FileRepository {
  private readonly files = new Map<string, StoredFile>();

  seed(files: StoredFile[]): void {
    this.files.clear();

    for (const file of files) {
      this.files.set(file.id, file);
    }
  }

  async upsertFileRow(record: CreateFileRecord) {
    const file = mustCreateFile(
      `file-${this.files.size + 1}`,
      record.canonicalUrl,
      record.filename,
      record.mimeType,
      record.sizeInBytes,
      record.createdAt.toISOString(),
    );
    this.files.set(file.id, file);
    return success(file);
  }

  async selectFileRow(id: string) {
    const file = this.files.get(id);

    if (!file) {
      return failure(new NotFoundError("File", id));
    }

    return success(file);
  }

  async deleteFileRow(id: string) {
    this.files.delete(id);
    return success(undefined);
  }
}

class InMemoryBlobRepository implements BlobRepository {
  async putBlob(request: {
    readonly conversationId: string;
    readonly content: ArrayBuffer;
    readonly filename: string;
    readonly mimeType: string;
  }) {
    const url = `/conversations/${request.conversationId}/file-1-${request.filename}`;
    return success(url);
  }

  async removeBlob(url: string) {
    return success(undefined);
  }
}

function mustCreateConversation(id: string, isoTimestamp: string): Conversation {
  return new Conversation({
    id,
    createdAt: new Date(isoTimestamp),
    updatedAt: new Date(isoTimestamp),
  });
}

function mustCreateMessage(
  id: string,
  conversationId: string,
  type: "user" | "assistant" | "system" | "tool",
  sequenceNumber: number,
  content: ReadonlyArray<ContentPart>,
  toolCalls: ReadonlyArray<ToolCall>,
  toolCallId: string,
  fileIds: ReadonlyArray<string>,
  isoTimestamp: string,
): Message {
  return new Message({
    id,
    conversationId,
    type,
    sequenceNumber,
    content,
    toolCalls,
    toolCallId,
    fileIds,
    createdAt: new Date(isoTimestamp),
    updatedAt: new Date(isoTimestamp),
  });
}

function mustCreateFile(
  id: string,
  canonicalUrl: string,
  filename: string,
  mimeType: string,
  sizeInBytes: number,
  isoTimestamp = "2026-03-16T12:00:00.000Z",
): StoredFile {
  return new StoredFile({
    id,
    canonicalUrl,
    filename,
    mimeType,
    sizeInBytes,
    createdAt: new Date(isoTimestamp),
    updatedAt: new Date(isoTimestamp),
  });
}

function textPart(text: string): ContentPart {
  return { type: "text", text };
}

function toolCall(id: string, name: string): ToolCall {
  return { id, name, args: { query: "hello" } };
}
