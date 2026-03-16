import { describe, expect, test } from "bun:test";
import type { BlobRepository } from "./contracts/blob-repository";
import type { CreateFileRecord, FileRepository } from "./contracts/file-repository";
import type {
  CreateMessageRecord,
  MessageRepository,
} from "./contracts/message-repository";
import { File } from "./objects/file";
import {
  BlobStoreError,
  ConstructionError,
  NotFoundError,
  StoreError,
} from "./objects/errors";
import { Message } from "./objects/message";
import { failure, success, type Result } from "./objects/result";
import { FileDomainService } from "./services/file-domain-service";
import { MessageDomainService } from "./services/message-domain-service";

describe("domain objects and services", () => {
  test("Message validates construction", () => {
    expect(
      () =>
        new Message({
          id: "message-1",
          conversationId: "conversation-1",
          sequenceNumber: 0,
          textContent: "hello",
          fileIds: [],
          createdAt: new Date("2026-03-16T12:00:00.000Z"),
          updatedAt: new Date("2026-03-16T12:00:00.000Z"),
        }),
    ).toThrow(
      new ConstructionError(
        "Message",
        "Message sequenceNumber must be a positive integer.",
      ).message,
    );
  });

  test("File validates construction", () => {
    expect(
      () =>
        new File({
          id: "file-1",
          canonicalUrl: "",
          filename: "a.txt",
          mimeType: "text/plain",
          sizeInBytes: 1,
          createdAt: new Date("2026-03-16T12:00:00.000Z"),
          updatedAt: new Date("2026-03-16T12:00:00.000Z"),
        }),
    ).toThrow(
      new ConstructionError("File", "File canonicalUrl must be a non-empty string.")
        .message,
    );
  });

  test("MessageDomainService creates messages with validated input", async () => {
    const repository = new InMemoryMessageRepository();
    const service = new MessageDomainService(
      repository,
      () => new Date("2026-03-16T12:00:00.000Z"),
    );

    const result = await service.createMessage({
      conversationId: "conversation-1",
      sequenceNumber: 1,
      textContent: "hello",
      fileIds: ["file-1"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(repository.createdRecords[0]).toEqual({
      conversationId: "conversation-1",
      sequenceNumber: 1,
      textContent: "hello",
      fileIds: ["file-1"],
      createdAt: new Date("2026-03-16T12:00:00.000Z"),
      updatedAt: new Date("2026-03-16T12:00:00.000Z"),
    });
  });

  test("FileDomainService uploads file bytes then persists metadata", async () => {
    const fileRepository = new InMemoryFileRepository();
    const blobRepository = new InMemoryBlobRepository();
    const service = new FileDomainService(
      fileRepository,
      blobRepository,
      () => new Date("2026-03-16T12:00:00.000Z"),
    );
    const content = new TextEncoder().encode("hello").buffer;

    const result = await service.uploadFile({
      content,
      filename: "hello.txt",
      mimeType: "text/plain",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(blobRepository.uploads).toHaveLength(1);
    expect(fileRepository.createdRecords[0]).toEqual({
      canonicalUrl: "https://blob/file-1",
      filename: "hello.txt",
      mimeType: "text/plain",
      sizeInBytes: content.byteLength,
      createdAt: new Date("2026-03-16T12:00:00.000Z"),
      updatedAt: new Date("2026-03-16T12:00:00.000Z"),
    });
  });

  test("FileDomainService short-circuits delete when blob removal fails", async () => {
    const fileRepository = new InMemoryFileRepository();
    fileRepository.seed([
      new File({
        id: "file-1",
        canonicalUrl: "https://blob/file-1",
        filename: "hello.txt",
        mimeType: "text/plain",
        sizeInBytes: 5,
        createdAt: new Date("2026-03-16T12:00:00.000Z"),
        updatedAt: new Date("2026-03-16T12:00:00.000Z"),
      }),
    ]);
    const blobRepository = new InMemoryBlobRepository();
    blobRepository.deleteFailure = new BlobStoreError("delete", "boom");
    const service = new FileDomainService(fileRepository, blobRepository);

    const result = await service.deleteFile("file-1");

    expect(result).toEqual(failure(new BlobStoreError("delete", "boom")));
    expect(fileRepository.deletedIds).toEqual([]);
  });
});

class InMemoryMessageRepository implements MessageRepository {
  readonly createdRecords: CreateMessageRecord[] = [];

  async create(record: CreateMessageRecord): Promise<Result<Message, StoreError>> {
    this.createdRecords.push(record);
    return success(
      new Message({
        id: "message-1",
        conversationId: record.conversationId,
        sequenceNumber: record.sequenceNumber,
        textContent: record.textContent,
        fileIds: record.fileIds,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }),
    );
  }

  async getById(id: string) {
    return failure(new NotFoundError("Message", id));
  }

  async listPageByConversation() {
    return success([]);
  }

  async listByConversation() {
    return success([]);
  }

  async countByConversation() {
    return success(0);
  }

  async deleteById() {
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
    const file = new File({
      id: "file-1",
      canonicalUrl: record.canonicalUrl,
      filename: record.filename,
      mimeType: record.mimeType,
      sizeInBytes: record.sizeInBytes,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
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
    this.deletedIds.push(id);
    this.files.delete(id);
    return success(undefined);
  }
}

class InMemoryBlobRepository implements BlobRepository {
  readonly uploads: Array<{
    readonly content: ArrayBuffer;
    readonly filename: string;
    readonly mimeType: string;
  }> = [];
  deleteFailure: BlobStoreError | null = null;

  async upload(request: {
    readonly content: ArrayBuffer;
    readonly filename: string;
    readonly mimeType: string;
  }) {
    this.uploads.push(request);
    return success("https://blob/file-1");
  }

  async delete() {
    if (this.deleteFailure) {
      return failure(this.deleteFailure);
    }

    return success(undefined);
  }
}
