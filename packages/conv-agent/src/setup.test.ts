import { describe, expect, test } from "bun:test";
import { createConversationHttpHandler } from "./adapter/inbound/conversation-http-handler";
import type { AppendUserMessageStore, PersistUserMessageWithFilesInput } from "./domain/contracts/append-user-message-store";
import type { BlobRepository } from "./domain/contracts/blob-repository";
import type { LlmCompletionService } from "./domain/contracts/llm-completion-service";
import type { ConversationRepository } from "./domain/contracts/conversation-repository";
import type { FileRepository } from "./domain/contracts/file-repository";
import type { MessageRepository } from "./domain/contracts/message-repository";
import { Conversation } from "./domain/objects/conversation";
import { EntityType, LlmError, NotFoundError, StoreError, StoreOperation } from "./domain/objects/errors";
import { File as StoredFile } from "./domain/objects/file";
import { LLMMessageType, type LlmCompletionResult } from "./domain/objects/llm";
import { type InsertNextMessageRecord, Message } from "./domain/objects/message";
import { failure, success, type Result } from "./domain/objects/result";
import { BlobDomainService } from "./domain/services/blob-domain-service";
import { AppendUserMessageDomainService } from "./domain/services/append-user-message-domain-service";
import { ConversationDomainService } from "./domain/services/conversation-domain-service";
import { FileDomainService } from "./domain/services/file-domain-service";
import { LlmDomainService } from "./domain/services/llm-domain-service";
import { MessageContentDomainService } from "./domain/services/message-content-domain-service";
import { MessageDomainService } from "./domain/services/message-domain-service";
import { AppendMessageToConversationFlow } from "./application/append-message-to-conversation-flow";
import { CreateConversationFlow } from "./application/create-conversation-flow";
import { DeleteConversationFlow } from "./application/delete-conversation-flow";
import { GetConversationFlow } from "./application/get-conversation-flow";
import { GetMessagesOnConversationFlow } from "./application/get-messages-on-conversation-flow";
import { ListConversationsFlow } from "./application/list-conversations-flow";

describe("message validation", () => {
  test("MessageContentDomainService allows empty persisted content now that attachment presence is validated at the flow boundary", () => {
    const messageContentDomainService = new MessageContentDomainService();
    const validUserInput = {
      conversationId: "conversation-1",
      type: LLMMessageType.User,
      content: "hello",
    };
    const emptyAssistantInput = {
      conversationId: "conversation-1",
      type: LLMMessageType.Assistant,
      content: "",
    };

    expect(messageContentDomainService.validateMessageInput(validUserInput)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(messageContentDomainService.validateMessageInput(emptyAssistantInput)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  test("MessageContentDomainService validates message content presence", () => {
    const messageContentDomainService = new MessageContentDomainService();
    const validToolInput = {
      conversationId: "conversation-1",
      type: LLMMessageType.Tool,
      content: "tool output",
    };
    const invalidToolInput = {
      conversationId: "conversation-1",
      type: LLMMessageType.Tool,
      content: 42,
    } as unknown as Parameters<MessageContentDomainService["validateMessageInput"]>[0];

    expect(messageContentDomainService.validateMessageInput(validToolInput).ok).toBe(true);
    expect(messageContentDomainService.validateMessageInput(invalidToolInput)).toEqual({
      ok: false,
      error: {
        kind: "ValidationError",
        fieldName: "content",
        message: "content must be a string.",
      },
    });
  });

  test("MessageContentDomainService validates persisted message structure", () => {
    const messageContentDomainService = new MessageContentDomainService();
    const validRecord: Omit<Message, "id"> = {
      conversationId: "conversation-1",
      type: LLMMessageType.Assistant,
      sequenceNumber: 2,
      content: "hello",
      createdAt: new Date("2026-03-16T12:00:00.000Z"),
      updatedAt: new Date("2026-03-16T12:00:00.000Z"),
    };
    const invalidRecord: Omit<Message, "id"> = {
      conversationId: "conversation-1",
      type: LLMMessageType.Assistant,
      sequenceNumber: 2,
      content: 42 as unknown as string,
      createdAt: new Date("2026-03-16T12:00:00.000Z"),
      updatedAt: new Date("2026-03-16T12:00:00.000Z"),
    };

    expect(messageContentDomainService.validateMessageRecord(validRecord).ok).toBe(true);
    expect(messageContentDomainService.validateMessageRecord(invalidRecord)).toEqual({
      ok: false,
      error: {
        kind: "ValidationError",
        fieldName: "content",
        message: "content must be a string.",
      },
    });
  });

  test("FileDomainService validates required upload fields", async () => {
    const fileDomainService = new FileDomainService(new InMemoryFileRepository(), new BlobDomainService(new InMemoryBlobRepository()), () => new Date("2026-03-16T12:00:00.000Z"));
    const validInput = {
      messageId: "message-1",
      content: new TextEncoder().encode("hello").buffer as ArrayBuffer,
      filename: "hello.txt",
      mimeType: "text/plain",
    };
    const invalidInput = {
      messageId: "message-1",
      content: new TextEncoder().encode("hello").buffer as ArrayBuffer,
      filename: "",
      mimeType: "text/plain",
    };

    expect((await fileDomainService.uploadFile(validInput)).ok).toBe(true);
    expect(await fileDomainService.uploadFile(invalidInput)).toEqual({
      ok: false,
      error: {
        kind: "ValidationError",
        fieldName: "filename",
        message: "filename must be a non-empty string.",
      },
    });
  });

  test("ConversationDomainService validates conversations returned from the repository", async () => {
    const repository = new InMemoryConversationRepository();
    const conversationDomainService = new ConversationDomainService(repository, () => new Date("2026-03-16T12:00:00.000Z"));

    repository.seed([new Conversation("conversation-1", new Date("invalid"), new Date("2026-03-16T12:00:00.000Z"))]);

    expect(await conversationDomainService.findById("conversation-1")).toEqual({
      ok: false,
      error: {
        kind: "StoreError",
        entityType: EntityType.Conversation,
        operation: StoreOperation.Read,
        message: "createdAt must be a valid date.",
      },
    });
  });

  test("FileDomainService validates files returned from the repository", async () => {
    const repository = new InMemoryFileRepository();
    const fileDomainService = new FileDomainService(repository, new BlobDomainService(new InMemoryBlobRepository()), () => new Date("2026-03-16T12:00:00.000Z"));

    repository.seed([
      new StoredFile(
        "file-1",
        "message-1",
        "/conversations/conversation-1/file-1.png",
        "file-1.png",
        "image/png",
        -1,
        new Date("2026-03-16T12:00:00.000Z"),
        new Date("2026-03-16T12:00:00.000Z"),
      ),
    ]);

    expect(await fileDomainService.findById("file-1")).toEqual({
      ok: false,
      error: {
        kind: "StoreError",
        entityType: EntityType.File,
        operation: StoreOperation.Read,
        message: "sizeInBytes must be a non-negative integer.",
      },
    });
  });

  test("MessageContentDomainService rejects invalid message types", () => {
    const messageContentDomainService = new MessageContentDomainService();
    const input = {
      conversationId: "conversation-1",
      type: "invalid",
      content: "hello",
    } as unknown as Parameters<MessageContentDomainService["validateMessageInput"]>[0];

    expect(messageContentDomainService.validateMessageInput(input)).toEqual({
      ok: false,
      error: {
        kind: "ValidationError",
        fieldName: "type",
        message: "type must be one of user, assistant, system, or tool.",
      },
    });
  });

  test("deleteMessageWithFiles removes files referenced by blob parts", async () => {
    const messageRepository = new InMemoryMessageRepository();
    const fileRepository = new InMemoryFileRepository();
    const blobRepository = new InMemoryBlobRepository();
    const messageContentDomainService = new MessageContentDomainService();
    const messageDomainService = new MessageDomainService(messageRepository, messageContentDomainService, () => new Date("2026-03-16T12:00:00.000Z"));
    const fileDomainService = new FileDomainService(fileRepository, new BlobDomainService(blobRepository), () => new Date("2026-03-16T12:00:00.000Z"));

    messageRepository.seed([mustCreateMessage("message-1", "conversation-1", LLMMessageType.User, 1, "hello", "2026-03-16T12:00:00.000Z")]);
    fileRepository.seed([mustCreateFile("file-1", "message-1", "/conversations/conversation-1/file-1.png", "file-1.png", "image/png", 4)]);

    const deleteResult = await messageDomainService.deleteMessageWithFiles("message-1", fileDomainService);

    expect(deleteResult.ok).toBe(true);
    expect(messageRepository.get("message-1")).toBeUndefined();
    expect(fileRepository.get("file-1")).toBeUndefined();
  });

  test("MessageDomainService creates the next message through the repository atomic insert path", async () => {
    const repository = new AtomicInsertOnlyMessageRepository();
    const messageDomainService = new MessageDomainService(
      repository,
      new MessageContentDomainService(),
      () => new Date("2026-03-16T12:00:00.000Z"),
    );

    const result = await messageDomainService.createNextMessage({
      conversationId: "conversation-1",
      type: LLMMessageType.User,
      content: "hello",
    });

    expect(result).toEqual({
      ok: true,
      value: mustCreateMessage("message-1", "conversation-1", LLMMessageType.User, 1, "hello", "2026-03-16T12:00:00.000Z"),
    });
    expect(repository.insertedRecords).toEqual([
      {
        conversationId: "conversation-1",
        type: LLMMessageType.User,
        content: "hello",
        createdAt: new Date("2026-03-16T12:00:00.000Z"),
        updatedAt: new Date("2026-03-16T12:00:00.000Z"),
      },
    ]);
  });

  test("AppendMessageToConversationFlow uploads blobs then persists one transactional user message write", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    const messageRepository = new InMemoryMessageRepository();
    const fileRepository = new InMemoryFileRepository();
    const blobRepository = new InMemoryBlobRepository();
    const appendUserMessageStore = new InMemoryAppendUserMessageStore(messageRepository, fileRepository, () => new Date("2026-03-16T12:00:00.000Z"));
    const flow = new AppendMessageToConversationFlow(
      new ConversationDomainService(conversationRepository, () => new Date("2026-03-16T12:00:00.000Z")),
      new AppendUserMessageDomainService(appendUserMessageStore),
      new MessageDomainService(messageRepository, new MessageContentDomainService(), () => new Date("2026-03-16T12:00:00.000Z")),
      new FileDomainService(fileRepository, new BlobDomainService(blobRepository), () => new Date("2026-03-16T12:00:00.000Z")),
      new LlmDomainService(new InMemoryLlmCompletionService()),
    );

    conversationRepository.seed([mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z")]);

    const result = await flow.execute({
      conversationId: "conversation-1",
      type: LLMMessageType.User,
      content: "hello",
      attachments: [
        {
          content: new TextEncoder().encode("hello").buffer as ArrayBuffer,
          filename: "hello.txt",
          mimeType: "text/plain",
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(appendUserMessageStore.persistedInputs).toEqual([
      {
        conversationId: "conversation-1",
        type: LLMMessageType.User,
        content: "hello",
        files: [
          {
            canonicalUrl: "/files/file-1-hello.txt",
            filename: "hello.txt",
            mimeType: "text/plain",
            sizeInBytes: 5,
          },
        ],
      },
    ]);
  });

  test("AppendMessageToConversationFlow deletes uploaded blobs when transactional persistence fails", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    const blobRepository = new InMemoryBlobRepository();
    const appendUserMessageStore = new FailingAppendUserMessageStore(
      new StoreError(EntityType.Message, StoreOperation.Persist, "transaction failed"),
    );
    const flow = new AppendMessageToConversationFlow(
      new ConversationDomainService(conversationRepository, () => new Date("2026-03-16T12:00:00.000Z")),
      new AppendUserMessageDomainService(appendUserMessageStore),
      new MessageDomainService(new InMemoryMessageRepository(), new MessageContentDomainService(), () => new Date("2026-03-16T12:00:00.000Z")),
      new FileDomainService(new InMemoryFileRepository(), new BlobDomainService(blobRepository), () => new Date("2026-03-16T12:00:00.000Z")),
      new LlmDomainService(new InMemoryLlmCompletionService()),
    );

    conversationRepository.seed([mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z")]);

    const result = await flow.execute({
      conversationId: "conversation-1",
      type: LLMMessageType.User,
      content: "hello",
      attachments: [
        {
          content: new TextEncoder().encode("hello").buffer as ArrayBuffer,
          filename: "hello.txt",
          mimeType: "text/plain",
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "StoreError",
        entityType: EntityType.Message,
        operation: StoreOperation.Persist,
        message: "transaction failed",
      },
    });
    expect(blobRepository.deletedUrls).toEqual(["/files/file-1-hello.txt"]);
  });

  test("AppendMessageToConversationFlow returns blob cleanup failure when transactional persistence and cleanup both fail", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    const blobRepository = new InMemoryBlobRepository();
    blobRepository.removeBlobResult = failure(new StoreError(EntityType.File, StoreOperation.Remove, "blob cleanup failed"));
    const flow = new AppendMessageToConversationFlow(
      new ConversationDomainService(conversationRepository, () => new Date("2026-03-16T12:00:00.000Z")),
      new AppendUserMessageDomainService(new FailingAppendUserMessageStore(new StoreError(EntityType.Message, StoreOperation.Persist, "transaction failed"))),
      new MessageDomainService(new InMemoryMessageRepository(), new MessageContentDomainService(), () => new Date("2026-03-16T12:00:00.000Z")),
      new FileDomainService(new InMemoryFileRepository(), new BlobDomainService(blobRepository), () => new Date("2026-03-16T12:00:00.000Z")),
      new LlmDomainService(new InMemoryLlmCompletionService()),
    );

    conversationRepository.seed([mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z")]);

    const result = await flow.execute({
      conversationId: "conversation-1",
      type: LLMMessageType.User,
      content: "hello",
      attachments: [
        {
          content: new TextEncoder().encode("hello").buffer as ArrayBuffer,
          filename: "hello.txt",
          mimeType: "text/plain",
        },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: {
        kind: "StoreError",
        entityType: EntityType.File,
        operation: StoreOperation.Remove,
        message: "blob cleanup failed",
      },
    });
    expect(blobRepository.deletedUrls).toEqual(["/files/file-1-hello.txt"]);
  });
});

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
    repository.seed([mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"), mustCreateConversation("conversation-2", "2026-03-16T13:00:00.000Z")]);
    const handler = buildHandler({ conversationRepository: repository });

    const createResponse = await handler(new Request("http://localhost/conversations", { method: "POST" }));
    const getResponse = await handler(new Request("http://localhost/conversations/conversation-1"));
    const listResponse = await handler(new Request("http://localhost/conversations?pageNum=1&pageSize=2"));

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

    const response = await handler(new Request("http://localhost/conversations/missing"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: new NotFoundError(EntityType.Conversation, "missing"),
    });
  });

  test("appends a message with multipart rich-message fields", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    conversationRepository.seed([mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z")]);
    const handler = buildHandler({ conversationRepository });
    const formData = new FormData();

    formData.set("type", "user");
    formData.set("content", "hello");
    formData.set("attachment", new globalThis.File(["hello"], "greeting.txt", { type: "text/plain" }));

    const response = await handler(
      new Request("http://localhost/conversations/conversation-1/chat", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  test("rejects invalid rich-message payloads", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    conversationRepository.seed([mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z")]);
    const handler = buildHandler({ conversationRepository });

    const missingContentFormData = new FormData();
    missingContentFormData.set("type", "user");

    const missingContentResponse = await handler(
      new Request("http://localhost/conversations/conversation-1/chat", {
        method: "POST",
        body: missingContentFormData,
      }),
    );

    expect(missingContentResponse.status).toBe(400);
    expect(await missingContentResponse.json()).toEqual({
      error: {
        kind: "ValidationError",
        fieldName: "content",
        message: "content must be present.",
      },
    });

    const invalidContentFormData = new FormData();
    invalidContentFormData.set("type", "user");
    invalidContentFormData.set("content", "");

    const invalidContentResponse = await handler(
      new Request("http://localhost/conversations/conversation-1/chat", {
        method: "POST",
        body: invalidContentFormData,
      }),
    );

    expect(invalidContentResponse.status).toBe(400);
    expect(await invalidContentResponse.json()).toEqual({
      error: {
        kind: "ValidationError",
        fieldName: "content",
        message: "content must be a non-empty string when no files are attached.",
      },
    });
  });

  test("lists messages for a conversation using the rich response shape", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    conversationRepository.seed([mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z")]);
    const messageRepository = new InMemoryMessageRepository();
    messageRepository.seed([
      mustCreateMessage("message-1", "conversation-1", LLMMessageType.User, 1, "one", "2026-03-16T12:00:00.000Z"),
      mustCreateMessage("message-2", "conversation-1", LLMMessageType.Assistant, 2, "two", "2026-03-16T12:01:00.000Z"),
    ]);
    const fileRepository = new InMemoryFileRepository();
    fileRepository.seed([mustCreateFile("file-1", "message-1", "/conversations/conversation-1/file-1-one.png", "one.png", "image/png", 3, "2026-03-16T11:59:00.000Z")]);
    const handler = buildHandler({
      conversationRepository,
      messageRepository,
      fileRepository,
    });

    const response = await handler(new Request("http://localhost/conversations/conversation-1/chat?pageNum=1&pageSize=2"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: "message-1",
          conversationId: "conversation-1",
          type: "user",
          sequenceNumber: 1,
          content: "one",
          files: [
            {
              id: "file-1",
              canonicalUrl: "/conversations/conversation-1/file-1-one.png",
              filename: "one.png",
              mimeType: "image/png",
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
          content: "two",
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
    repository.seed([mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z")]);
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
  readonly appendUserMessageStore?: AppendUserMessageStore;
  readonly blobRepository?: InMemoryBlobRepository;
  readonly llmCompletionService?: InMemoryLlmCompletionService;
}) {
  const conversationRepository = overrides?.conversationRepository ?? new InMemoryConversationRepository();
  const messageRepository = overrides?.messageRepository ?? new InMemoryMessageRepository();
  const fileRepository = overrides?.fileRepository ?? new InMemoryFileRepository();
  const now = () => new Date("2026-03-16T12:00:00.000Z");
  const appendUserMessageStore = overrides?.appendUserMessageStore ?? new InMemoryAppendUserMessageStore(messageRepository, fileRepository, now);
  const blobRepository = overrides?.blobRepository ?? new InMemoryBlobRepository();
  const llmCompletionService = overrides?.llmCompletionService ?? new InMemoryLlmCompletionService();
  const conversationDomainService = new ConversationDomainService(conversationRepository, now);
  const appendUserMessageDomainService = new AppendUserMessageDomainService(appendUserMessageStore);
  const blobDomainService = new BlobDomainService(blobRepository);
  const messageContentDomainService = new MessageContentDomainService();
  const messageDomainService = new MessageDomainService(messageRepository, messageContentDomainService, now);
  const llmDomainService = new LlmDomainService(llmCompletionService);
  const fileDomainService = new FileDomainService(fileRepository, blobDomainService, now);

  return createConversationHttpHandler({
    createConversation: new CreateConversationFlow(conversationDomainService),
    getConversation: new GetConversationFlow(conversationDomainService),
    listConversations: new ListConversationsFlow(conversationDomainService),
    deleteConversation: new DeleteConversationFlow(conversationDomainService, messageDomainService, fileDomainService),
    appendMessageToConversation: new AppendMessageToConversationFlow(
      conversationDomainService,
      appendUserMessageDomainService,
      messageDomainService,
      fileDomainService,
      llmDomainService,
    ),
    getMessagesOnConversation: new GetMessagesOnConversationFlow(conversationDomainService, messageDomainService, fileDomainService),
  });
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

  async upsertConversationRow(record: Omit<Conversation, "id">): Promise<Result<Conversation, StoreError>> {
    const conversation = mustCreateConversation("conversation-created", record.createdAt.toISOString());
    this.conversations.set(conversation.id, conversation);
    return success(conversation);
  }

  async selectConversationRow(conversationId: string) {
    const conversation = this.conversations.get(conversationId);

    if (!conversation) {
      return failure(new NotFoundError(EntityType.Conversation, conversationId));
    }

    return success(conversation);
  }

  async selectConversationPage(request: { readonly pageNum: number; readonly pageSize: number }) {
    const items = [...this.conversations.values()].sort((left, right) => {
      const updatedAtDelta = right.updatedAt.getTime() - left.updatedAt.getTime();

      if (updatedAtDelta !== 0) {
        return updatedAtDelta;
      }

      return right.id.localeCompare(left.id);
    });

    const offset = (request.pageNum - 1) * request.pageSize;
    return success(items.slice(offset, offset + request.pageSize));
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

  get(messageId: string): Message | undefined {
    return this.messages.get(messageId);
  }

  async insertNextMessageRow(record: InsertNextMessageRecord) {
    const nextSequenceNumber =
      [...this.messages.values()]
        .filter((message) => message.conversationId === record.conversationId)
        .reduce((highest, message) => Math.max(highest, message.sequenceNumber), 0) + 1;
    const message = mustCreateMessage(
      `message-${this.messages.size + 1}`,
      record.conversationId,
      record.type,
      nextSequenceNumber,
      record.content,
      record.createdAt.toISOString(),
    );
    this.messages.set(message.id, message);
    return success(message);
  }

  async selectMessageRow(messageId: string) {
    const message = this.messages.get(messageId);

    if (!message) {
      return failure(new NotFoundError(EntityType.Message, messageId));
    }

    return success(message);
  }

  async selectMessagePage(request: { readonly conversationId: string; readonly pageNum: number; readonly pageSize: number }) {
    const fromSequence = (request.pageNum - 1) * request.pageSize + 1;
    return success(
      [...this.messages.values()]
        .filter((message) => message.conversationId === request.conversationId && message.sequenceNumber >= fromSequence)
        .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
        .slice(0, request.pageSize),
    );
  }

  async selectAllMessagesByConversation(conversationId: string) {
    return success([...this.messages.values()].filter((message) => message.conversationId === conversationId));
  }

  async deleteMessageRow(messageId: string) {
    this.messages.delete(messageId);
    return success(undefined);
  }

  async deleteMessagesByConversation(conversationId: string) {
    for (const [id, message] of this.messages) {
      if (message.conversationId === conversationId) {
        this.messages.delete(id);
      }
    }

    return success(undefined);
  }
}

class AtomicInsertOnlyMessageRepository implements MessageRepository {
  readonly insertedRecords: InsertNextMessageRecord[] = [];

  async insertNextMessageRow(record: InsertNextMessageRecord) {
    this.insertedRecords.push(record);
    return success(
      mustCreateMessage("message-1", record.conversationId, record.type, 1, record.content, record.createdAt.toISOString()),
    );
  }

  async selectMessageRow(_messageId: string): Promise<Result<Message, NotFoundError | StoreError>> {
    throw new Error("selectMessageRow should not be called in this test.");
  }

  async selectMessagePage(_request: {
    readonly conversationId: string;
    readonly pageNum: number;
    readonly pageSize: number;
  }): Promise<Result<Message[], StoreError>> {
    throw new Error("selectMessagePage should not be called in this test.");
  }

  async selectAllMessagesByConversation(_conversationId: string): Promise<Result<Message[], StoreError>> {
    throw new Error("selectAllMessagesByConversation should not be called in this test.");
  }

  async deleteMessageRow(_messageId: string): Promise<Result<void, StoreError>> {
    throw new Error("deleteMessageRow should not be called in this test.");
  }

  async deleteMessagesByConversation(_conversationId: string): Promise<Result<void, StoreError>> {
    throw new Error("deleteMessagesByConversation should not be called in this test.");
  }
}

class InMemoryAppendUserMessageStore implements AppendUserMessageStore {
  readonly persistedInputs: PersistUserMessageWithFilesInput[] = [];

  constructor(
    private readonly messageRepository: InMemoryMessageRepository,
    private readonly fileRepository: InMemoryFileRepository,
    private readonly now: () => Date,
  ) {}

  async persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<Message, StoreError>> {
    this.persistedInputs.push(input);
    const timestamp = this.now();
    const messageResult = await this.messageRepository.insertNextMessageRow({
      conversationId: input.conversationId,
      type: input.type,
      content: input.content,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    if (!messageResult.ok) {
      return messageResult;
    }

    for (const file of input.files) {
      const fileResult: Result<StoredFile, StoreError> = await this.fileRepository.upsertFileRow({
        messageId: messageResult.value.id,
        canonicalUrl: file.canonicalUrl,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeInBytes: file.sizeInBytes,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      if (fileResult.ok) {
        continue;
      }

      return { ok: false, error: fileResult.error };
    }

    return messageResult;
  }
}

class FailingAppendUserMessageStore implements AppendUserMessageStore {
  constructor(private readonly error: StoreError) {}

  async persistUserMessageWithFiles(_input: PersistUserMessageWithFilesInput): Promise<Result<Message, StoreError>> {
    return failure(this.error);
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

  get(id: string): StoredFile | undefined {
    return this.files.get(id);
  }

  async upsertFileRow(record: Omit<StoredFile, "id">): Promise<Result<StoredFile, StoreError>> {
    const file = mustCreateFile(
      `file-${this.files.size + 1}`,
      record.messageId,
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
      return failure(new NotFoundError(EntityType.File, id));
    }

    return success(file);
  }

  async selectFileRows(ids: ReadonlyArray<string>) {
    const files: StoredFile[] = [];

    for (const id of ids) {
      const file = this.files.get(id);

      if (file) {
        files.push(file);
      }
    }

    return success(files);
  }

  async selectFileRowsByMessageIds(messageIds: ReadonlyArray<string>) {
    const allowedMessageIds = new Set(messageIds);

    return success([...this.files.values()].filter((file) => allowedMessageIds.has(file.messageId)));
  }

  async deleteFileRow(id: string) {
    this.files.delete(id);
    return success(undefined);
  }

  async deleteFileRows(ids: ReadonlyArray<string>) {
    for (const id of ids) {
      this.files.delete(id);
    }

    return success(undefined);
  }

  async deleteFileRowsByMessageIds(messageIds: ReadonlyArray<string>) {
    const allowedMessageIds = new Set(messageIds);

    for (const [id, file] of this.files) {
      if (allowedMessageIds.has(file.messageId)) {
        this.files.delete(id);
      }
    }

    return success(undefined);
  }
}

class InMemoryBlobRepository implements BlobRepository {
  readonly deletedUrls: string[] = [];
  removeBlobResult: Result<void, StoreError> | null = null;

  async putBlob(request: { readonly content: ArrayBuffer; readonly filename: string; readonly mimeType: string }) {
    const url = `/files/file-1-${request.filename}`;
    return success(url);
  }

  async removeBlob(url: string) {
    this.deletedUrls.push(url);

    if (this.removeBlobResult) {
      return this.removeBlobResult;
    }

    return success(undefined);
  }
}

class InMemoryLlmCompletionService implements LlmCompletionService {
  result: Result<LlmCompletionResult, LlmError> | null = null;

  async llmComplete(messages: ReadonlyArray<Message>) {
    if (this.result) {
      return this.result;
    }

    const latestMessage = messages.at(-1);

    return success({
      content: latestMessage?.content || "empty",
    });
  }
}

function mustCreateConversation(id: string, isoTimestamp: string): Conversation {
  return new Conversation(id, new Date(isoTimestamp), new Date(isoTimestamp));
}

function mustCreateMessage(id: string, conversationId: string, type: LLMMessageType, sequenceNumber: number, content: string, isoTimestamp: string): Message {
  return new Message(id, conversationId, type, sequenceNumber, content, new Date(isoTimestamp), new Date(isoTimestamp));
}

function mustCreateFile(
  id: string,
  messageId: string,
  canonicalUrl: string,
  filename: string,
  mimeType: string,
  sizeInBytes: number,
  isoTimestamp = "2026-03-16T12:00:00.000Z",
): StoredFile {
  return new StoredFile(id, messageId, canonicalUrl, filename, mimeType, sizeInBytes, new Date(isoTimestamp), new Date(isoTimestamp));
}
