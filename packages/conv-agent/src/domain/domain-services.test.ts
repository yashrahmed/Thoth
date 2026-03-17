import { describe, expect, test } from "bun:test";
import type {
  BlobRepository,
  BlobUploadRequest,
} from "./contracts/blob-repository";
import type {
  ConversationPageRequest,
  ConversationRepository,
  CreateConversationRecord,
} from "./contracts/conversation-repository";
import type {
  CreateFileRecord,
  FileRepository,
} from "./contracts/file-repository";
import type {
  CreateMessageRecord,
  MessagePageRequest,
  MessageRepository,
} from "./contracts/message-repository";
import { Conversation } from "./objects/conversation";
import { File } from "./objects/file";
import {
  BlobStoreError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "./objects/errors";
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
    expect(repository.lastPageRequest).toEqual({ pageNum: 1, pageSize: 2 });
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
    expect(repository.uploads).toHaveLength(0);
    expect(repository.deletedUrls).toHaveLength(0);
  });

  test("MessageDomainService exposes direct store counterparts", async () => {
    const repository = new InMemoryMessageRepository();
    repository.seed([
      mustCreateMessage(
        "message-1",
        "conversation-1",
        1,
        "one",
        [],
        "2026-03-16T12:00:00.000Z",
      ),
      mustCreateMessage(
        "message-2",
        "conversation-1",
        2,
        "two",
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
      sequenceNumber: 3,
      textContent: "three",
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
      sequenceNumber: 3,
      textContent: "three",
      fileIds: ["file-1"],
      createdAt: new Date("2026-03-16T12:02:00.000Z"),
      updatedAt: new Date("2026-03-16T12:02:00.000Z"),
    });
    expect(repository.lastPageRequest).toEqual({
      conversationId: "conversation-1",
      pageNum: 2,
      pageSize: 1,
    });
    expect(repository.deletedIds).toEqual(["message-2", "message-1"]);
  });

  test("MessageDomainService validates message ids for direct read/remove actions", async () => {
    const service = new MessageDomainService(new InMemoryMessageRepository());

    const getResult = await service.readFromMessageDBStore("");
    const removeResult = await service.removeFromMessageDBStore("");

    expect(getResult.ok).toBe(false);
    expect(removeResult.ok).toBe(false);
    if (getResult.ok || removeResult.ok) {
      return;
    }

    expect(getResult.error).toEqual(
      new ValidationError(
        "id",
        "id must be a non-empty string.",
      ),
    );
    expect(removeResult.error).toEqual(
      new ValidationError(
        "id",
        "id must be a non-empty string.",
      ),
    );
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
    if (!uploadResult.ok) {
      return;
    }

    const deleteRecordResult = await service.removeFromFileDBStore(createResult.ok ? createResult.value.id : "");
    const deleteFileResult = await service.deleteFile(uploadResult.value.id);

    expect(deleteRecordResult.ok).toBe(true);
    expect(deleteFileResult.ok).toBe(true);
    expect(blobRepository.uploads).toHaveLength(1);
    expect(blobRepository.deletedUrls).toEqual([
      uploadResult.value.canonicalUrl,
    ]);
  });

  test("FileDomainService validates file ids for direct read/remove actions", async () => {
    const service = new FileDomainService(
      new InMemoryFileRepository(),
      new BlobDomainService(new InMemoryBlobRepository()),
    );

    const getResult = await service.readFromFileDBStore("");
    const deleteRecordResult = await service.removeFromFileDBStore("");

    expect(getResult.ok).toBe(false);
    expect(deleteRecordResult.ok).toBe(false);
    if (getResult.ok || deleteRecordResult.ok) {
      return;
    }

    expect(getResult.error).toEqual(
      new ValidationError("id", "id must be a non-empty string."),
    );
    expect(deleteRecordResult.error).toEqual(
      new ValidationError("id", "id must be a non-empty string."),
    );
  });
});

class InMemoryConversationRepository implements ConversationRepository {
  createdRecord: CreateConversationRecord | null = null;
  lastPageRequest: ConversationPageRequest | null = null;
  readonly deletedIds: string[] = [];
  private readonly conversations = new Map<string, Conversation>();

  seed(conversations: Conversation[]): void {
    this.conversations.clear();

    for (const conversation of conversations) {
      this.conversations.set(conversation.id, conversation);
    }
  }

  async persistToConversationDBStore(
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

  async readFromConversationDBStore(id: string) {
    const conversation = this.conversations.get(id);

    if (!conversation) {
      return failure(new NotFoundError("Conversation", id));
    }

    return success(conversation);
  }

  async readPageFromConversationDBStore(request: ConversationPageRequest) {
    this.lastPageRequest = request;
    const offset = (request.pageNum - 1) * request.pageSize;
    const items = [...this.conversations.values()].sort(
      (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
    );

    return success(items.slice(offset, offset + request.pageSize));
  }

  async removeFromConversationDBStore(id: string) {
    this.deletedIds.push(id);
    this.conversations.delete(id);
    return success(undefined);
  }
}

class InMemoryMessageRepository implements MessageRepository {
  readonly createdRecords: CreateMessageRecord[] = [];
  readonly deletedIds: string[] = [];
  lastPageRequest: MessagePageRequest | null = null;
  private readonly messages = new Map<string, Message>();

  seed(messages: Message[]): void {
    this.messages.clear();

    for (const message of messages) {
      this.messages.set(message.id, message);
    }
  }

  async persistToMessageDBStore(record: CreateMessageRecord) {
    this.createdRecords.push(record);
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

  async readFromMessageDBStore(id: string) {
    const message = this.messages.get(id);

    if (!message) {
      return failure(new NotFoundError("Message", id));
    }

    return success(message);
  }

  async readPageFromMessageDBStore(request: MessagePageRequest) {
    this.lastPageRequest = request;
    const fromSequence = (request.pageNum - 1) * request.pageSize + 1;

    return success(
      [...this.messages.values()]
        .filter(
          (message) =>
            message.conversationId === request.conversationId &&
            message.sequenceNumber >= fromSequence,
        )
        .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
        .slice(0, request.pageSize),
    );
  }

  async readAllMessagesFromMessageDBStore(conversationId: string) {
    return success(
      [...this.messages.values()]
        .filter((message) => message.conversationId === conversationId)
        .sort((left, right) => left.sequenceNumber - right.sequenceNumber),
    );
  }

  async readMessageCountFromMessageDBStore(conversationId: string) {
    return success(
      [...this.messages.values()].filter(
        (message) => message.conversationId === conversationId,
      ).length,
    );
  }

  async removeFromMessageDBStore(id: string) {
    this.deletedIds.push(id);
    this.messages.delete(id);
    return success(undefined);
  }
}

class InMemoryFileRepository implements FileRepository {
  private readonly files = new Map<string, File>();

  seed(files: File[]): void {
    this.files.clear();

    for (const file of files) {
      this.files.set(file.id, file);
    }
  }

  async persistToFileDBStore(record: CreateFileRecord) {
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

  async readFromFileDBStore(id: string) {
    const file = this.files.get(id);

    if (!file) {
      return failure(new NotFoundError("File", id));
    }

    return success(file);
  }

  async removeFromFileDBStore(id: string) {
    this.files.delete(id);
    return success(undefined);
  }
}

class InMemoryBlobRepository implements BlobRepository {
  readonly uploads: BlobUploadRequest[] = [];
  readonly deletedUrls: string[] = [];
  deleteFailure: BlobStoreError | null = null;

  async uploadToBlobStore(request: BlobUploadRequest) {
    this.uploads.push(request);
    return success(
      `/conversations/${request.conversationId}/file-${this.uploads.length}-${request.filename}`,
    );
  }

  async deleteFromBlobStore(url: string) {
    if (this.deleteFailure) {
      return failure(this.deleteFailure);
    }

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
