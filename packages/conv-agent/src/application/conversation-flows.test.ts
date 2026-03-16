import { describe, expect, test } from "bun:test";
import type {
  CreateConversationRecord,
  ConversationPageRequest,
  ConversationRepository,
} from "../domain/contracts/conversation-repository";
import { CreateConversationFlow } from "./create-conversation-flow";
import { DeleteConversationFlow } from "./delete-conversation-flow";
import { GetConversationFlow } from "./get-conversation-flow";
import { ListConversationsFlow } from "./list-conversations-flow";
import { Conversation } from "../domain/objects/conversation";
import { NotFoundError, StoreError } from "../domain/objects/errors";
import { failure, success, type Result } from "../domain/objects/result";

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

    expect(result).toEqual(failure(new NotFoundError("missing-id")));
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

    expect(repository.lastPageRequest).toEqual({ offset: 1, limit: 1 });
    expect(validResult.value.map((conversation) => conversation.id)).toEqual([
      "conversation-2",
    ]);
  });

  test("DeleteConversation validates id, checks existence, and deletes once", async () => {
    const repository = new InMemoryConversationRepository();
    repository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
    ]);
    const useCase = new DeleteConversationFlow(repository);

    const invalidResult = await useCase.execute({ conversationId: "   " });

    expect(invalidResult.ok).toBe(false);
    if (invalidResult.ok) {
      return;
    }
    expect(invalidResult.error.kind).toBe("ValidationError");

    const validResult = await useCase.execute({ conversationId: "conversation-1" });

    expect(validResult).toEqual(success(undefined));
    expect(repository.deletedIds).toEqual(["conversation-1"]);
  });

  test("DeleteConversation returns repository delete failures", async () => {
    const repository = new InMemoryConversationRepository();
    repository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
    ]);
    repository.deleteFailure = new StoreError("remove", "delete failed");
    const useCase = new DeleteConversationFlow(repository);

    const result = await useCase.execute({ conversationId: "conversation-1" });

    expect(result).toEqual(failure(new StoreError("remove", "delete failed")));
  });
});

class InMemoryConversationRepository implements ConversationRepository {
  readonly createdIds: string[] = [];
  createdRecord: CreateConversationRecord | null = null;
  readonly deletedIds: string[] = [];
  lastPageRequest: ConversationPageRequest | null = null;
  deleteFailure: StoreError | null = null;
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
    const conversation = this.conversations.get(id);

    if (!conversation) {
      return failure(new NotFoundError(id));
    }

    return success(conversation);
  }

  async listPage(
    request: ConversationPageRequest,
  ): Promise<Result<Conversation[], StoreError>> {
    this.lastPageRequest = request;
    const items = [...this.conversations.values()].sort((left, right) => {
      const updatedAtDelta =
        right.updatedAt.getTime() - left.updatedAt.getTime();

      if (updatedAtDelta !== 0) {
        return updatedAtDelta;
      }

      return right.id.localeCompare(left.id);
    });

    return success(items.slice(request.offset, request.offset + request.limit));
  }

  async deleteById(id: string): Promise<Result<void, StoreError>> {
    if (this.deleteFailure) {
      return failure(this.deleteFailure);
    }

    this.deletedIds.push(id);
    this.conversations.delete(id);
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
