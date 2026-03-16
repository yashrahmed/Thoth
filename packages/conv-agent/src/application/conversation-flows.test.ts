import { describe, expect, test } from "bun:test";
import type { BlobRepository } from "../domain/contracts/blob-repository";
import type {
  CreateConversationRecord,
  ConversationPageRequest,
  ConversationRepository,
} from "../domain/contracts/conversation-repository";
import type {
  CreateFileRecord,
  FileRepository,
} from "../domain/contracts/file-repository";
import type {
  CreateMessageRecord,
  MessagePageRequest,
  MessageRepository,
} from "../domain/contracts/message-repository";
import { Conversation } from "../domain/objects/conversation";
import { File } from "../domain/objects/file";
import {
  BlobStoreError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../domain/objects/errors";
import { Message } from "../domain/objects/message";
import { failure, success, type Result } from "../domain/objects/result";
import { FileDomainService } from "../domain/services/file-domain-service";
import { MessageDomainService } from "../domain/services/message-domain-service";
import {
  requireNonEmptyString,
  requirePositiveInteger,
  requirePresent,
} from "../domain/validation";
import { AppendMessageToConversationFlow } from "./append-message-to-conversation-flow";
import { CreateConversationFlow } from "./create-conversation-flow";
import { DeleteConversationFlow } from "./delete-conversation-flow";
import { GetConversationFlow } from "./get-conversation-flow";
import { GetMessagesOnConversationFlow } from "./get-messages-on-conversation-flow";
import { ListConversationsFlow } from "./list-conversations-flow";

describe("conversation flows", () => {
  test("CreateConversation sets timestamps and persists once", async () => {
    const repository = new InMemoryConversationRepository();
    const now = new Date("2026-03-16T12:00:00.000Z");
    const useCase = new CreateConversationFlow(repository, () => now);

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.id).toBe("conversation-1");
    expect(result.value.createdAt.toISOString()).toBe(now.toISOString());
    expect(result.value.updatedAt.toISOString()).toBe(now.toISOString());
    expect(repository.createdRecord).toEqual({
      createdAt: now,
      updatedAt: now,
    });
    expect(repository.createdIds).toEqual(["conversation-1"]);
  });

  test("GetConversation returns NotFound for unknown ids", async () => {
    const repository = new InMemoryConversationRepository();
    const useCase = new GetConversationFlow(repository);

    const result = await useCase.execute({ conversationId: "missing-id" });

    expect(result).toEqual(failure(new NotFoundError("Conversation", "missing-id")));
  });

  test("ListConversations rejects invalid pagination and computes offset correctly", async () => {
    const repository = new InMemoryConversationRepository();
    repository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T11:00:00.000Z"),
      mustCreateConversation("conversation-2", "2026-03-16T12:00:00.000Z"),
      mustCreateConversation("conversation-3", "2026-03-16T13:00:00.000Z"),
    ]);
    const useCase = new ListConversationsFlow(repository);

    const invalidResult = await useCase.execute({ pageNum: 0, pageSize: 2 });

    expect(invalidResult.ok).toBe(false);
    if (invalidResult.ok) {
      return;
    }
    expect(invalidResult.error.kind).toBe("ValidationError");

    const validResult = await useCase.execute({ pageNum: 2, pageSize: 1 });

    expect(validResult.ok).toBe(true);
    if (!validResult.ok) {
      return;
    }

    expect(repository.lastPageRequest).toEqual({ pageNum: 2, pageSize: 1 });
    expect(validResult.value.map((conversation) => conversation.id)).toEqual([
      "conversation-2",
    ]);
  });

  test("AppendMessageToConversation appends text-only messages", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    conversationRepository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
    ]);
    const messageRepository = new InMemoryMessageRepository();
    const fileRepository = new InMemoryFileRepository();
    const blobRepository = new InMemoryBlobRepository();
    const fileDomainService = new FileDomainService(
      fileRepository,
      blobRepository,
      () => new Date("2026-03-16T12:01:00.000Z"),
    );
    const messageDomainService = new MessageDomainService(
      messageRepository,
      () => new Date("2026-03-16T12:02:00.000Z"),
    );
    const useCase = new AppendMessageToConversationFlow(
      conversationRepository,
      messageDomainService,
      fileDomainService,
    );

    const result = await useCase.execute({
      conversationId: "conversation-1",
      textContent: "hello",
      attachments: [],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.sequenceNumber).toBe(1);
    expect(result.value.textContent).toBe("hello");
    expect(result.value.fileIds).toEqual([]);
    expect(messageRepository.createdRecords[0]).toEqual({
      conversationId: "conversation-1",
      sequenceNumber: 1,
      textContent: "hello",
      fileIds: [],
      createdAt: new Date("2026-03-16T12:02:00.000Z"),
      updatedAt: new Date("2026-03-16T12:02:00.000Z"),
    });
  });

  test("AppendMessageToConversation uploads attachments before creating the message", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    conversationRepository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
    ]);
    const messageRepository = new InMemoryMessageRepository();
    const fileRepository = new InMemoryFileRepository();
    const blobRepository = new InMemoryBlobRepository();
    const fileDomainService = new FileDomainService(
      fileRepository,
      blobRepository,
      () => new Date("2026-03-16T12:01:00.000Z"),
    );
    const messageDomainService = new MessageDomainService(
      messageRepository,
      () => new Date("2026-03-16T12:02:00.000Z"),
    );
    const useCase = new AppendMessageToConversationFlow(
      conversationRepository,
      messageDomainService,
      fileDomainService,
    );
    const attachmentContent = new TextEncoder().encode("hello world").buffer;

    const result = await useCase.execute({
      conversationId: "conversation-1",
      textContent: "hello",
      attachments: [
        {
          content: attachmentContent,
          filename: "greeting.txt",
          mimeType: "text/plain",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(blobRepository.uploads).toHaveLength(1);
    expect(fileRepository.createdRecords[0]?.filename).toBe("greeting.txt");
    expect(result.value.fileIds).toEqual(["file-1"]);
    expect(result.value.sequenceNumber).toBe(1);
  });

  test("AppendMessageToConversation returns not found before writing when the conversation is missing", async () => {
    const conversationRepository = new InMemoryConversationRepository();
    const messageRepository = new InMemoryMessageRepository();
    const fileRepository = new InMemoryFileRepository();
    const blobRepository = new InMemoryBlobRepository();
    const useCase = new AppendMessageToConversationFlow(
      conversationRepository,
      new MessageDomainService(messageRepository),
      new FileDomainService(fileRepository, blobRepository),
    );

    const result = await useCase.execute({
      conversationId: "missing",
      textContent: "hello",
      attachments: [],
    });

    expect(result).toEqual(failure(new NotFoundError("Conversation", "missing")));
    expect(messageRepository.createdRecords).toEqual([]);
    expect(fileRepository.createdRecords).toEqual([]);
  });

  test("GetMessagesOnConversation validates pagination and returns file metadata", async () => {
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
      mustCreateMessage("message-3", "conversation-1", 3, "three", [], "2026-03-16T12:02:00.000Z"),
    ]);
    const fileRepository = new InMemoryFileRepository();
    fileRepository.seed([
      mustCreateFile(
        "file-1",
        "/conversations/conversation-1/file-1-a.txt",
        "a.txt",
        "text/plain",
        1,
      ),
    ]);
    const useCase = new GetMessagesOnConversationFlow(
      conversationRepository,
      new MessageDomainService(messageRepository),
      new FileDomainService(fileRepository, new InMemoryBlobRepository()),
    );

    const invalidResult = await useCase.execute({
      conversationId: "conversation-1",
      pageNum: 1,
      pageSize: 0,
    });

    expect(invalidResult.ok).toBe(false);
    if (invalidResult.ok) {
      return;
    }
    expect(invalidResult.error.kind).toBe("ValidationError");

    const validResult = await useCase.execute({
      conversationId: "conversation-1",
      pageNum: 1,
      pageSize: 1,
    });

    expect(validResult.ok).toBe(true);
    if (!validResult.ok) {
      return;
    }

    expect(messageRepository.lastPageRequest).toEqual({
      conversationId: "conversation-1",
      pageNum: 1,
      pageSize: 1,
    });
    expect(validResult.value.map((message) => message.id)).toEqual(["message-1"]);
    expect(validResult.value[0]?.files).toEqual([
      {
        id: "file-1",
        canonicalUrl: "/conversations/conversation-1/file-1-a.txt",
        filename: "a.txt",
        mimeType: "text/plain",
        sizeInBytes: 1,
        createdAt: new Date("2026-03-16T12:00:00.000Z"),
        updatedAt: new Date("2026-03-16T12:00:00.000Z"),
      },
    ]);
  });

  test("DeleteConversation deletes files, then messages, then the conversation", async () => {
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
        "hello",
        ["file-1", "file-2"],
        "2026-03-16T12:00:00.000Z",
      ),
    ]);
    const fileRepository = new InMemoryFileRepository();
    fileRepository.seed([
      mustCreateFile(
        "file-1",
        "/conversations/conversation-1/file-1-a.txt",
        "a.txt",
        "text/plain",
        1,
      ),
      mustCreateFile(
        "file-2",
        "/conversations/conversation-1/file-2-b.txt",
        "b.txt",
        "text/plain",
        1,
      ),
    ]);
    const blobRepository = new InMemoryBlobRepository();
    blobRepository.seed([
      ["/conversations/conversation-1/file-1-a.txt", new TextEncoder().encode("a").buffer],
      ["/conversations/conversation-1/file-2-b.txt", new TextEncoder().encode("b").buffer],
    ]);
    const useCase = new DeleteConversationFlow(
      conversationRepository,
      new MessageDomainService(messageRepository),
      new FileDomainService(fileRepository, blobRepository),
    );

    const result = await useCase.execute({ conversationId: "conversation-1" });

    expect(result).toEqual(success(undefined));
    expect(blobRepository.deletedUrls).toEqual([
      "/conversations/conversation-1/file-1-a.txt",
      "/conversations/conversation-1/file-2-b.txt",
    ]);
    expect(messageRepository.deletedIds).toEqual(["message-1"]);
    expect(conversationRepository.deletedIds).toEqual(["conversation-1"]);
  });

  test("DeleteConversation short-circuits on blob deletion failure", async () => {
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
        "hello",
        ["file-1"],
        "2026-03-16T12:00:00.000Z",
      ),
    ]);
    const fileRepository = new InMemoryFileRepository();
    fileRepository.seed([
      mustCreateFile(
        "file-1",
        "/conversations/conversation-1/file-1-a.txt",
        "a.txt",
        "text/plain",
        1,
      ),
    ]);
    const blobRepository = new InMemoryBlobRepository();
    blobRepository.deleteFailure = new BlobStoreError("delete", "boom");
    const useCase = new DeleteConversationFlow(
      conversationRepository,
      new MessageDomainService(messageRepository),
      new FileDomainService(fileRepository, blobRepository),
    );

    const result = await useCase.execute({ conversationId: "conversation-1" });

    expect(result).toEqual(failure(new BlobStoreError("delete", "boom")));
    expect(messageRepository.deletedIds).toEqual([]);
    expect(conversationRepository.deletedIds).toEqual([]);
  });
});

class InMemoryConversationRepository implements ConversationRepository {
  readonly createdIds: string[] = [];
  createdRecord: CreateConversationRecord | null = null;
  readonly deletedIds: string[] = [];
  lastPageRequest: ConversationPageRequest | null = null;
  private readonly conversations = new Map<string, Conversation>();

  seed(conversations: Conversation[]): void {
    this.conversations.clear();

    for (const conversation of conversations) {
      this.conversations.set(conversation.id, conversation);
    }
  }

  async create(record: CreateConversationRecord): Promise<Result<Conversation, StoreError>> {
    this.createdRecord = record;
    const conversation = mustCreateConversation(
      `conversation-${this.createdIds.length + 1}`,
      record.createdAt.toISOString(),
    );
    this.createdIds.push(conversation.id);
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

  async listPage(
    request: ConversationPageRequest,
  ): Promise<Result<Conversation[], ValidationError | StoreError>> {
    const pageNumResult = requirePositiveInteger(request.pageNum, "pageNum");

    if (!pageNumResult.ok) {
      return pageNumResult;
    }

    const pageSizeResult = requirePositiveInteger(request.pageSize, "pageSize");

    if (!pageSizeResult.ok) {
      return pageSizeResult;
    }

    this.lastPageRequest = request;
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

  async deleteById(id: string): Promise<Result<void, ValidationError | StoreError>> {
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
  readonly createdRecords: CreateMessageRecord[] = [];
  readonly deletedIds: string[] = [];
  lastPageRequest: MessagePageRequest | null = null;
  deleteFailure: StoreError | null = null;
  private readonly messages = new Map<string, Message>();

  seed(messages: Message[]): void {
    this.messages.clear();

    for (const message of messages) {
      this.messages.set(message.id, message);
    }
  }

  async create(
    record: CreateMessageRecord,
  ): Promise<Result<Message, ValidationError | StoreError>> {
    const validationResult = validateCreateMessageRecord(record);

    if (!validationResult.ok) {
      return validationResult;
    }

    this.createdRecords.push(record);
    const message = mustCreateMessage(
      `message-${this.createdRecords.length}`,
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

  async listPageByConversation(
    request: MessagePageRequest,
  ): Promise<Result<Message[], ValidationError | StoreError>> {
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

    this.lastPageRequest = request;
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

  async listByConversation(
    conversationId: string,
  ): Promise<Result<Message[], ValidationError | StoreError>> {
    const conversationIdResult = requireNonEmptyString(
      conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    return success(
      [...this.messages.values()]
        .filter((message) => message.conversationId === conversationIdResult.value)
        .sort((left, right) => left.sequenceNumber - right.sequenceNumber),
    );
  }

  async countByConversation(
    conversationId: string,
  ): Promise<Result<number, ValidationError | StoreError>> {
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

  async deleteById(id: string): Promise<Result<void, StoreError>> {
    if (this.deleteFailure) {
      return failure(this.deleteFailure);
    }

    this.deletedIds.push(id);
    this.messages.delete(id);
    return success(undefined);
  }
}

class InMemoryFileRepository implements FileRepository {
  readonly createdRecords: CreateFileRecord[] = [];
  readonly deletedIds: string[] = [];
  private readonly files = new Map<string, File>();

  seed(files: File[]): void {
    this.files.clear();

    for (const file of files) {
      this.files.set(file.id, file);
    }
  }

  async create(record: CreateFileRecord): Promise<Result<File, StoreError>> {
    this.createdRecords.push(record);
    const file = mustCreateFile(
      `file-${this.createdRecords.length}`,
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

  async deleteById(id: string): Promise<Result<void, StoreError>> {
    this.deletedIds.push(id);
    this.files.delete(id);
    return success(undefined);
  }
}

class InMemoryBlobRepository implements BlobRepository {
  readonly uploads: Array<{
    readonly conversationId: string;
    readonly filename: string;
    readonly mimeType: string;
    readonly content: ArrayBuffer;
  }> = [];
  readonly deletedUrls: string[] = [];
  deleteFailure: BlobStoreError | null = null;
  private readonly blobs = new Map<string, ArrayBuffer>();

  seed(entries: ReadonlyArray<readonly [string, ArrayBuffer]>): void {
    this.blobs.clear();

    for (const [url, content] of entries) {
      this.blobs.set(url, content);
    }
  }

  async upload(request: {
    readonly conversationId: string;
    readonly content: ArrayBuffer;
    readonly filename: string;
    readonly mimeType: string;
  }) {
    const contentResult = requirePresent(request.content, "content");

    if (!contentResult.ok) {
      return contentResult;
    }

    const conversationIdResult = requireNonEmptyString(
      request.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const filenameResult = requireNonEmptyString(request.filename, "filename");

    if (!filenameResult.ok) {
      return filenameResult;
    }

    const mimeTypeResult = requireNonEmptyString(request.mimeType, "mimeType");

    if (!mimeTypeResult.ok) {
      return mimeTypeResult;
    }

    this.uploads.push(request);
    const url = `/conversations/${conversationIdResult.value}/file-${this.uploads.length}-${filenameResult.value}`;
    this.blobs.set(url, request.content);
    return success(url);
  }

  async delete(canonicalUrl: string) {
    if (this.deleteFailure) {
      return failure(this.deleteFailure);
    }

    this.deletedUrls.push(canonicalUrl);
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
  isoTimestamp = "2026-03-16T12:00:00.000Z",
): File {
  return new File({
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
