import { describe, expect, test } from "bun:test";
import type {
  BlobRepository,
  BlobUploadRequest,
} from "./contracts/blob-repository";
import type {
  ConversationOffsetPageRequest,
  ConversationRepository,
  CreateConversationRecord,
} from "./contracts/conversation-repository";
import type {
  CreateFileRecord,
  FileRepository,
} from "./contracts/file-repository";
import type {
  CreateMessageRecord,
  MessageRepository,
  MessageSequencePageRequest,
} from "./contracts/message-repository";
import { Conversation } from "./objects/conversation";
import { File } from "./objects/file";
import {
  BlobStoreError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "./objects/errors";
import type { ContentPart, ToolCall } from "./objects/message-content";
import { Message } from "./objects/message";
import { failure, success, type Result } from "./objects/result";
import { BlobDomainService } from "./services/blob-domain-service";
import { ConversationDomainService } from "./services/conversation-domain-service";
import { FileDomainService } from "./services/file-domain-service";
import { MessageDomainService } from "./services/message-domain-service";

describe("domain services", () => {
  test("ConversationDomainService creates, reads, pages, and deletes conversations", async () => {
    const repository = new InMemoryConversationRepository();
    repository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T11:00:00.000Z"),
      mustCreateConversation("conversation-2", "2026-03-16T12:00:00.000Z"),
    ]);
    const service = new ConversationDomainService(
      repository,
      () => new Date("2026-03-16T13:00:00.000Z"),
    );

    const createResult = await service.createConversation();
    const getResult = await service.readFromConversationDBStore("conversation-2");
    const listResult = await service.readPageFromConversationDBStore({
      pageNum: 1,
      pageSize: 2,
    });
    const deleteResult = await service.removeFromConversationDBStore("conversation-1");

    expect(createResult.ok).toBe(true);
    expect(getResult.ok).toBe(true);
    expect(listResult.ok).toBe(true);
    expect(deleteResult.ok).toBe(true);
    expect(repository.createdRecord).toEqual({
      createdAt: new Date("2026-03-16T13:00:00.000Z"),
      updatedAt: new Date("2026-03-16T13:00:00.000Z"),
    });
    expect(repository.lastPageRequest).toEqual({ offset: 0, pageSize: 2 });
    expect(repository.deletedIds).toEqual(["conversation-1"]);
  });

  test("BlobDomainService delegates upload and delete", async () => {
    const repository = new InMemoryBlobRepository();
    const service = new BlobDomainService(repository);
    const content = new TextEncoder().encode("hello").buffer;

    const uploadResult = await service.uploadToBlobStore({
      conversationId: "conversation-1",
      content,
      filename: "hello.txt",
      mimeType: "text/plain",
    });

    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok) {
      return;
    }

    const deleteResult = await service.deleteFromBlobStore(uploadResult.value);

    expect(deleteResult).toEqual(success(undefined));
    expect(repository.uploads).toHaveLength(1);
    expect(repository.deletedUrls).toEqual([uploadResult.value]);
  });

  test("BlobDomainService validates upload and delete inputs before delegating", async () => {
    const repository = new InMemoryBlobRepository();
    const service = new BlobDomainService(repository);
    const content = new TextEncoder().encode("hello").buffer;

    const invalidUploadResult = await service.uploadToBlobStore({
      conversationId: "",
      content,
      filename: "hello.txt",
      mimeType: "text/plain",
    });
    const invalidDeleteResult = await service.deleteFromBlobStore("");

    expect(invalidUploadResult.ok).toBe(false);
    expect(invalidDeleteResult.ok).toBe(false);
    if (invalidUploadResult.ok || invalidDeleteResult.ok) {
      return;
    }

    expect(invalidUploadResult.error).toEqual(
      new ValidationError(
        "conversationId",
        "conversationId must be a non-empty string.",
      ),
    );
    expect(invalidDeleteResult.error).toEqual(
      new ValidationError(
        "canonicalUrl",
        "canonicalUrl must be a non-empty string.",
      ),
    );
  });

  test("MessageDomainService exposes direct store counterparts with rich message data", async () => {
    const repository = new InMemoryMessageRepository();
    repository.seed([
      mustCreateMessage(
        "message-1",
        "conversation-1",
        "user",
        1,
        [textPart("one")],
        [],
        "",
        [],
        "2026-03-16T12:00:00.000Z",
      ),
      mustCreateMessage(
        "message-2",
        "conversation-1",
        "assistant",
        2,
        [textPart("two")],
        [],
        "",
        [],
        "2026-03-16T12:01:00.000Z",
      ),
    ]);
    const service = new MessageDomainService(
      repository,
      () => new Date("2026-03-16T12:02:00.000Z"),
    );

    const createResult = await service.createMessage({
      conversationId: "conversation-1",
      type: "tool",
      sequenceNumber: 3,
      content: [textPart("three")],
      toolCalls: [toolCall("tool-call-1", "search")],
      toolCallId: "tool-call-1",
      fileIds: ["file-1"],
    });
    const getResult = await service.readFromMessageDBStore("message-1");
    const removeRecordResult = await service.removeFromMessageDBStore("message-2");
    const pageResult = await service.readPageFromMessageDBStore({
      conversationId: "conversation-1",
      pageNum: 2,
      pageSize: 1,
    });
    const listResult = await service.readAllMessagesFromMessageDBStore("conversation-1");
    const countResult = await service.readMessageCountFromMessageDBStore("conversation-1");
    const deleteResult = await service.deleteMessage("message-1");

    expect(createResult.ok).toBe(true);
    expect(getResult.ok).toBe(true);
    expect(removeRecordResult.ok).toBe(true);
    expect(pageResult.ok).toBe(true);
    expect(listResult.ok).toBe(true);
    expect(countResult.ok).toBe(true);
    expect(deleteResult.ok).toBe(true);
    expect(repository.createdRecords[0]).toEqual({
      conversationId: "conversation-1",
      type: "tool",
      sequenceNumber: 3,
      content: [textPart("three")],
      toolCalls: [toolCall("tool-call-1", "search")],
      toolCallId: "tool-call-1",
      fileIds: ["file-1"],
      createdAt: new Date("2026-03-16T12:02:00.000Z"),
      updatedAt: new Date("2026-03-16T12:02:00.000Z"),
    });
    expect(repository.lastPageRequest).toEqual({
      conversationId: "conversation-1",
      fromSequence: 2,
      pageSize: 1,
    });
    expect(repository.deletedIds).toEqual(["message-2", "message-1"]);
  });

  test("MessageDomainService validates rich message records", async () => {
    const service = new MessageDomainService(new InMemoryMessageRepository());

    const invalidTypeResult = await service.persistToMessageDBStore({
      conversationId: "conversation-1",
      type: "bad" as "user",
      sequenceNumber: 1,
      content: [textPart("hello")],
      toolCalls: [],
      toolCallId: "",
      fileIds: [],
      createdAt: new Date("2026-03-16T12:00:00.000Z"),
      updatedAt: new Date("2026-03-16T12:00:00.000Z"),
    });
    const invalidToolCallResult = await service.persistToMessageDBStore({
      conversationId: "conversation-1",
      type: "assistant",
      sequenceNumber: 1,
      content: [textPart("hello")],
      toolCalls: [{ id: "", name: "search", args: {} }],
      toolCallId: "",
      fileIds: [],
      createdAt: new Date("2026-03-16T12:00:00.000Z"),
      updatedAt: new Date("2026-03-16T12:00:00.000Z"),
    });

    expect(invalidTypeResult).toEqual(
      failure(
        new ValidationError(
          "type",
          "type must be one of user, assistant, system, or tool.",
        ),
      ),
    );
    expect(invalidToolCallResult).toEqual(
      failure(
        new ValidationError(
          "toolCall.id",
          "toolCall.id must be a non-empty string.",
        ),
      ),
    );
  });

  test("MessageDomainService createNextMessage computes count plus one", async () => {
    const repository = new InMemoryMessageRepository();
    repository.seed([
      mustCreateMessage(
        "message-1",
        "conversation-1",
        "user",
        1,
        [textPart("one")],
        [],
        "",
        [],
        "2026-03-16T12:00:00.000Z",
      ),
    ]);
    const service = new MessageDomainService(
      repository,
      () => new Date("2026-03-16T12:03:00.000Z"),
    );

    const result = await service.createNextMessage({
      conversationId: "conversation-1",
      type: "assistant",
      content: [textPart("two")],
      toolCalls: [],
      toolCallId: "",
      fileIds: [],
    });

    expect(result.ok).toBe(true);
    expect(repository.createdRecords[0]?.sequenceNumber).toBe(2);
  });

  test("MessageDomainService deleteMessageWithFiles deletes files before the message", async () => {
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
    const fileDomainService = new FileDomainService(
      fileRepository,
      new BlobDomainService(blobRepository),
    );
    const service = new MessageDomainService(messageRepository);

    const result = await service.deleteMessageWithFiles("message-1", fileDomainService);

    expect(result).toEqual(success(undefined));
    expect(blobRepository.deletedUrls).toEqual([
      "/conversations/conversation-1/file-1-a.txt",
    ]);
    expect(fileRepository.deletedIds).toEqual(["file-1"]);
    expect(messageRepository.deletedIds).toEqual(["message-1"]);
  });

  test("FileDomainService exposes direct store counterparts and composed blob-backed methods", async () => {
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
    const blobDomainService = new BlobDomainService(blobRepository);
    const service = new FileDomainService(
      fileRepository,
      blobDomainService,
      () => new Date("2026-03-16T12:00:00.000Z"),
    );
    const content = new TextEncoder().encode("hello").buffer;

    const createResult = await service.persistToFileDBStore({
      canonicalUrl: "/conversations/conversation-1/file-2-b.txt",
      filename: "b.txt",
      mimeType: "text/plain",
      sizeInBytes: 1,
      createdAt: new Date("2026-03-16T12:00:00.000Z"),
      updatedAt: new Date("2026-03-16T12:00:00.000Z"),
    });
    const getResult = await service.readFromFileDBStore("file-1");
    const uploadResult = await service.uploadFile({
      conversationId: "conversation-1",
      content,
      filename: "hello.txt",
      mimeType: "text/plain",
    });

    expect(createResult.ok).toBe(true);
    expect(getResult.ok).toBe(true);
    expect(uploadResult.ok).toBe(true);
    if (!uploadResult.ok || !createResult.ok) {
      return;
    }

    const filesResult = await service.getFiles({
      fileIds: ["file-1", uploadResult.value.id],
    });
    const deleteRecordResult = await service.removeFromFileDBStore(createResult.value.id);
    const deleteFileResult = await service.deleteFile(uploadResult.value.id);

    expect(filesResult.ok).toBe(true);
    expect(deleteRecordResult.ok).toBe(true);
    expect(deleteFileResult.ok).toBe(true);
    expect(blobRepository.uploads).toHaveLength(1);
    expect(blobRepository.deletedUrls).toEqual([
      uploadResult.value.canonicalUrl,
    ]);
  });
});

class InMemoryConversationRepository implements ConversationRepository {
  createdRecord: CreateConversationRecord | null = null;
  lastPageRequest: ConversationOffsetPageRequest | null = null;
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
    this.createdRecord = record;
    const conversation = mustCreateConversation(
      `conversation-${this.conversations.size + 1}`,
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
    this.lastPageRequest = request;
    const items = [...this.conversations.values()].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );

    return success(items.slice(request.offset, request.offset + request.pageSize));
  }

  async deleteConversationRow(conversationId: string) {
    this.deletedIds.push(conversationId);
    this.conversations.delete(conversationId);
    return success(undefined);
  }
}

class InMemoryMessageRepository implements MessageRepository {
  readonly createdRecords: CreateMessageRecord[] = [];
  readonly deletedIds: string[] = [];
  lastPageRequest: MessageSequencePageRequest | null = null;
  private readonly messages = new Map<string, Message>();

  seed(messages: Message[]): void {
    this.messages.clear();

    for (const message of messages) {
      this.messages.set(message.id, message);
    }
  }

  async upsertMessageRow(record: CreateMessageRecord) {
    this.createdRecords.push(record);
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
    this.lastPageRequest = request;

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
      [...this.messages.values()]
        .filter((message) => message.conversationId === conversationId)
        .sort((left, right) => left.sequenceNumber - right.sequenceNumber),
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
    this.deletedIds.push(messageId);
    this.messages.delete(messageId);
    return success(undefined);
  }
}

class InMemoryFileRepository implements FileRepository {
  readonly deletedIds: string[] = [];
  private readonly files = new Map<string, File>();

  seed(files: File[]): void {
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
    this.deletedIds.push(id);
    this.files.delete(id);
    return success(undefined);
  }
}

class InMemoryBlobRepository implements BlobRepository {
  readonly uploads: BlobUploadRequest[] = [];
  readonly deletedUrls: string[] = [];

  async putBlob(request: BlobUploadRequest) {
    this.uploads.push(request);
    return success(
      `/conversations/${request.conversationId}/file-${this.uploads.length}-${request.filename}`,
    );
  }

  async removeBlob(url: string) {
    this.deletedUrls.push(url);
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

function textPart(text: string): ContentPart {
  return { type: "text", text };
}

function toolCall(id: string, name: string): ToolCall {
  return { id, name, args: { query: "hello" } };
}
