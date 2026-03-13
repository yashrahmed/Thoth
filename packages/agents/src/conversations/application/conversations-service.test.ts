import { describe, expect, mock, test } from "bun:test";
import type {
  BlobStore,
  Conversation,
  ConversationId,
  ConversationRepository,
} from "@thoth/entities";
import { ConversationsService } from "./conversations-service";

class InMemoryConversationRepository implements ConversationRepository {
  public readonly store = new Map<string, Conversation>();
  public failNextSave = false;

  public async getById(conversationId: ConversationId): Promise<Conversation | null> {
    return this.store.get(conversationId.value) ?? null;
  }

  public async list(): Promise<Conversation[]> {
    return [...this.store.values()];
  }

  public async save(conversation: Conversation): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("save failed");
    }

    this.store.set(conversation.id.value, conversation);
  }

  public async delete(conversationId: ConversationId): Promise<void> {
    this.store.delete(conversationId.value);
  }
}

function createBlobStore(): BlobStore & {
  deletedKeys: string[];
  storedKeys: string[];
} {
  const storedKeys: string[] = [];
  const deletedKeys: string[] = [];

  return {
    storedKeys,
    deletedKeys,
    putObject: mock(async ({ objectKey }) => {
      storedKeys.push(objectKey);

      return {
        objectKey,
        byteSize: 4,
        contentType: "text/plain",
        etag: "etag",
        lastModified: new Date("2026-03-11T18:00:00.000Z"),
      };
    }),
    headObject: mock(async () => null),
    getObject: mock(async () => {
      throw new Error("not implemented");
    }),
    deleteObject: mock(async ({ objectKey }) => {
      deletedKeys.push(objectKey);
    }),
    copyObject: mock(async ({ destinationObjectKey }) => ({
      objectKey: destinationObjectKey,
      byteSize: null,
      contentType: null,
      etag: null,
      lastModified: null,
    })),
  };
}

describe("ConversationsService", () => {
  test("creates a conversation and posts a text message", async () => {
    const repository = new InMemoryConversationRepository();
    const blobStore = createBlobStore();
    const service = new ConversationsService(repository, blobStore);
    const conversation = await service.createConversation({});

    const message = await service.postMessage({
      conversationId: conversation.id,
      role: "user",
      textContent: "hello",
      attachments: [],
    });

    expect(conversation.id).toBeString();
    expect(message.role).toBe("user");
    expect(message.textContent).toBe("hello");
    expect(message.id).toBeString();
    expect((await service.getConversationById(conversation.id))?.messages).toHaveLength(1);
  });

  test("cleans up uploaded blobs when aggregate persistence fails", async () => {
    const repository = new InMemoryConversationRepository();
    const blobStore = createBlobStore();
    const service = new ConversationsService(repository, blobStore);
    const conversation = await service.createConversation({});

    repository.failNextSave = true;

    await expect(
      service.postMessage({
        conversationId: conversation.id,
        role: "user",
        textContent: "file",
        attachments: [
          {
            originalFilename: "note.txt",
            mediaType: "text/plain",
            byteSize: 4,
            body: new TextEncoder().encode("test").buffer,
          },
        ],
      }),
    ).rejects.toThrow("save failed");

    expect(blobStore.storedKeys).toHaveLength(1);
    expect(blobStore.deletedKeys).toEqual(blobStore.storedKeys);
  });
});
