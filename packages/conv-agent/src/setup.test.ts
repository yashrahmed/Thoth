import { describe, expect, test } from "bun:test";
import { createConversationHttpHandler } from "./adapter/inbound/conversation-http-handler";
import type { BlobRepository } from "./domain/contracts/blob-repository";
import type {
  CreateConversationRecord,
  ConversationPageRequest,
  ConversationRepository,
} from "./domain/contracts/conversation-repository";
import type {
  CreateFileRecord,
  FileRepository,
} from "./domain/contracts/file-repository";
import type {
  CreateMessageRecord,
  MessagePageRequest,
  MessageRepository,
} from "./domain/contracts/message-repository";
import { Conversation } from "./domain/objects/conversation";
import { File as StoredFile } from "./domain/objects/file";
import { NotFoundError, ValidationError, type StoreError } from "./domain/objects/errors";
import { Message } from "./domain/objects/message";
import { failure, success, type Result } from "./domain/objects/result";
import { BlobDomainService } from "./domain/services/blob-domain-service";
import { ConversationDomainService } from "./domain/services/conversation-domain-service";
import { FileDomainService } from "./domain/services/file-domain-service";
import { MessageDomainService } from "./domain/services/message-domain-service";
import {
  requireNonEmptyString,
  requirePositiveInteger,
  requirePresent,
} from "./domain/validation";
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

  test("creates a conversation", async () => {
    const handler = buildHandler();

    const response = await handler(
      new Request("http://localhost/conversations", { method: "POST" }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: "conversation-created",
      createdAt: "2026-03-16T12:00:00.000Z",
      updatedAt: "2026-03-16T12:00:00.000Z",
    });
  });

  test("gets a conversation and maps not found to 404", async () => {
    const repository = new InMemoryConversationRepository();
    repository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
    ]);
    const handler = buildHandler({ conversationRepository: repository });

    const successResponse = await handler(
      new Request("http://localhost/conversations/conversation-1"),
    );

    expect(successResponse.status).toBe(200);
    expect(await successResponse.json()).toEqual({
      id: "conversation-1",
      createdAt: "2026-03-16T12:00:00.000Z",
      updatedAt: "2026-03-16T12:00:00.000Z",
    });

    const missingResponse = await handler(
      new Request("http://localhost/conversations/missing"),
    );

    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toEqual({
      error: new NotFoundError("Conversation", "missing"),
    });
  });

  test("lists conversations and validates pagination", async () => {
    const repository = new InMemoryConversationRepository();
    repository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
      mustCreateConversation("conversation-2", "2026-03-16T13:00:00.000Z"),
    ]);
    const handler = buildHandler({ conversationRepository: repository });

    const response = await handler(
      new Request("http://localhost/conversations?pageNum=1&pageSize=2"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: "conversation-2",
          createdAt: "2026-03-16T13:00:00.000Z",
          updatedAt: "2026-03-16T13:00:00.000Z",
        },
        {
          id: "conversation-1",
          createdAt: "2026-03-16T12:00:00.000Z",
          updatedAt: "2026-03-16T12:00:00.000Z",
        },
      ],
      pageNum: 1,
      pageSize: 2,
    });

    const invalidResponse = await handler(
      new Request("http://localhost/conversations?pageNum=1&pageSize=0"),
    );

    expect(invalidResponse.status).toBe(400);
  });

  test("appends a message with multipart form data", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    conversationRepository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
    ]);
    const handler = buildHandler({ conversationRepository });
    const formData = new FormData();

    formData.set("textContent", "hello");
    formData.set(
      "attachment",
      new globalThis.File(["hello"], "greeting.txt", { type: "text/plain" }),
    );

    const response = await handler(
      new Request("http://localhost/conversations/conversation-1/messages", {
        method: "POST",
        body: formData,
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      id: "message-1",
      conversationId: "conversation-1",
      sequenceNumber: 1,
      textContent: "hello",
      fileIds: ["file-1"],
      createdAt: "2026-03-16T12:00:00.000Z",
      updatedAt: "2026-03-16T12:00:00.000Z",
    });
  });

  test("lists messages for a conversation", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    conversationRepository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
    ]);
    const messageRepository = new InMemoryMessageRepository();
    messageRepository.seed([
      mustCreateMessage(
        "message-1",
        "conversation-1",
        1,
        "one",
        ["file-1"],
        "2026-03-16T12:00:00.000Z",
      ),
      mustCreateMessage("message-2", "conversation-1", 2, "two", [], "2026-03-16T12:01:00.000Z"),
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
        "http://localhost/conversations/conversation-1/messages?pageNum=1&pageSize=2",
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [
        {
          id: "message-1",
          conversationId: "conversation-1",
          sequenceNumber: 1,
          textContent: "one",
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
          sequenceNumber: 2,
          textContent: "two",
          files: [],
          createdAt: "2026-03-16T12:01:00.000Z",
          updatedAt: "2026-03-16T12:01:00.000Z",
        },
      ],
      pageNum: 1,
      pageSize: 2,
    });
  });

  test("maps invalid message routes to 400 and missing conversations to 404", async () => {
    const handler = buildHandler();

    const invalidFormData = new FormData();
    invalidFormData.set(
      "attachment",
      new globalThis.File(["hello"], "greeting.txt", { type: "text/plain" }),
    );

    const invalidResponse = await handler(
      new Request("http://localhost/conversations/conversation-1/messages", {
        method: "POST",
        body: invalidFormData,
      }),
    );

    expect(invalidResponse.status).toBe(400);

    const missingResponse = await handler(
      new Request(
        "http://localhost/conversations/missing/messages?pageNum=1&pageSize=1",
      ),
    );

    expect(missingResponse.status).toBe(404);
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

  async create(record: CreateConversationRecord): Promise<Result<Conversation, StoreError>> {
    const conversation = mustCreateConversation(
      "conversation-created",
      record.createdAt.toISOString(),
    );
    this.conversations.set(conversation.id, conversation);
    return success(conversation);
  }

  async getById(id: string) {
    const idResult = requireNonEmptyString(id, "id");

    if (!idResult.ok) {
      return idResult;
    }

    const conversation = this.conversations.get(idResult.value);

    if (!conversation) {
      return failure(new NotFoundError("Conversation", idResult.value));
    }

    return success(conversation);
  }

  async listPage(request: ConversationPageRequest) {
    const pageNumResult = requirePositiveInteger(request.pageNum, "pageNum");

    if (!pageNumResult.ok) {
      return pageNumResult;
    }

    const pageSizeResult = requirePositiveInteger(request.pageSize, "pageSize");

    if (!pageSizeResult.ok) {
      return pageSizeResult;
    }

    const items = [...this.conversations.values()].sort((left, right) => {
      const updatedAtDelta =
        right.updatedAt.getTime() - left.updatedAt.getTime();

      if (updatedAtDelta !== 0) {
        return updatedAtDelta;
      }

      return right.id.localeCompare(left.id);
    });

    const offset = (pageNumResult.value - 1) * pageSizeResult.value;

    return success(items.slice(offset, offset + pageSizeResult.value));
  }

  async deleteById(id: string) {
    const idResult = requireNonEmptyString(id, "id");

    if (!idResult.ok) {
      return idResult;
    }

    this.deletedIds.push(idResult.value);
    this.conversations.delete(idResult.value);
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

  async create(record: CreateMessageRecord) {
    const validationResult = validateCreateMessageRecord(record);

    if (!validationResult.ok) {
      return validationResult;
    }

    const message = mustCreateMessage(
      `message-${this.messages.size + 1}`,
      record.conversationId,
      record.sequenceNumber,
      record.textContent,
      record.fileIds,
      record.createdAt.toISOString(),
    );
    this.messages.set(message.id, message);
    return success(message);
  }

  async getById(id: string) {
    const message = this.messages.get(id);

    if (!message) {
      return failure(new NotFoundError("Message", id));
    }

    return success(message);
  }

  async listPageByConversation(request: MessagePageRequest) {
    const conversationIdResult = requireNonEmptyString(
      request.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const pageNumResult = requirePositiveInteger(request.pageNum, "pageNum");

    if (!pageNumResult.ok) {
      return pageNumResult;
    }

    const pageSizeResult = requirePositiveInteger(request.pageSize, "pageSize");

    if (!pageSizeResult.ok) {
      return pageSizeResult;
    }

    const fromSequence = (pageNumResult.value - 1) * pageSizeResult.value + 1;

    return success(
      [...this.messages.values()]
        .filter(
          (message) =>
            message.conversationId === conversationIdResult.value &&
            message.sequenceNumber >= fromSequence,
        )
        .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
        .slice(0, pageSizeResult.value),
    );
  }

  async listByConversation(conversationId: string) {
    const conversationIdResult = requireNonEmptyString(
      conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    return success(
      [...this.messages.values()].filter(
        (message) => message.conversationId === conversationIdResult.value,
      ),
    );
  }

  async countByConversation(conversationId: string) {
    const conversationIdResult = requireNonEmptyString(
      conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    return success(
      [...this.messages.values()].filter(
        (message) => message.conversationId === conversationIdResult.value,
      ).length,
    );
  }

  async deleteById(id: string) {
    this.messages.delete(id);
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

  async create(record: CreateFileRecord) {
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

  async getById(id: string) {
    const file = this.files.get(id);

    if (!file) {
      return failure(new NotFoundError("File", id));
    }

    return success(file);
  }

  async deleteById(id: string) {
    this.files.delete(id);
    return success(undefined);
  }
}

class InMemoryBlobRepository implements BlobRepository {
  private readonly blobs = new Map<string, ArrayBuffer>();

  async upload(request: {
    readonly conversationId: string;
    readonly content: ArrayBuffer;
    readonly filename: string;
    readonly mimeType: string;
  }) {
    const url = `/conversations/${request.conversationId}/file-${this.blobs.size + 1}-${request.filename}`;
    this.blobs.set(url, request.content);
    return success(url);
  }

  async delete(canonicalUrl: string) {
    this.blobs.delete(canonicalUrl);
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
  sequenceNumber: number,
  textContent: string,
  fileIds: ReadonlyArray<string>,
  isoTimestamp: string,
): Message {
  return new Message({
    id,
    conversationId,
    sequenceNumber,
    textContent,
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
  isoTimestamp: string,
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

function validateCreateMessageRecord(
  record: CreateMessageRecord,
): Result<void, ValidationError> {
  const conversationIdResult = requireNonEmptyString(
    record.conversationId,
    "conversationId",
  );

  if (!conversationIdResult.ok) {
    return conversationIdResult;
  }

  const sequenceNumberResult = requirePositiveInteger(
    record.sequenceNumber,
    "sequenceNumber",
  );

  if (!sequenceNumberResult.ok) {
    return sequenceNumberResult;
  }

  const textContentResult = requirePresent(record.textContent, "textContent");

  if (!textContentResult.ok) {
    return textContentResult;
  }

  for (const fileId of record.fileIds) {
    const fileIdResult = requireNonEmptyString(fileId, "fileId");

    if (!fileIdResult.ok) {
      return fileIdResult;
    }
  }

  return success(undefined);
}
