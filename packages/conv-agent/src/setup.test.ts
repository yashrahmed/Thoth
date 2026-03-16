import { describe, expect, test } from "bun:test";
import type {
  CreateConversationRecord,
  ConversationPageRequest,
  ConversationRepository,
} from "./domain/contracts/conversation-repository";
import { CreateConversationFlow } from "./application/create-conversation-flow";
import { DeleteConversationFlow } from "./application/delete-conversation-flow";
import { GetConversationFlow } from "./application/get-conversation-flow";
import { ListConversationsFlow } from "./application/list-conversations-flow";
import { Conversation } from "./domain/objects/conversation";
import { NotFoundError, type StoreError } from "./domain/objects/errors";
import { failure, success, type Result } from "./domain/objects/result";
import { createConvAgentFetchHandler } from "./setup";

describe("createConvAgentFetchHandler", () => {
  test("returns a local health response", async () => {
    const repository = new InMemoryConversationRepository();
    const handler = createConvAgentFetchHandler(
      new CreateConversationFlow(repository, () => new Date("2026-03-16T12:00:00.000Z")),
      new GetConversationFlow(repository),
      new ListConversationsFlow(repository),
      new DeleteConversationFlow(repository),
    );

    const response = await handler(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "conv-agent",
    });
  });

  test("creates a conversation", async () => {
    const repository = new InMemoryConversationRepository();
    const handler = createConvAgentFetchHandler(
      new CreateConversationFlow(repository, () => new Date("2026-03-16T12:00:00.000Z")),
      new GetConversationFlow(repository),
      new ListConversationsFlow(repository),
      new DeleteConversationFlow(repository),
    );

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
    const handler = createConvAgentFetchHandler(
      new CreateConversationFlow(repository, () => new Date("2026-03-16T12:00:00.000Z")),
      new GetConversationFlow(repository),
      new ListConversationsFlow(repository),
      new DeleteConversationFlow(repository),
    );

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
      error: new NotFoundError("missing"),
    });
  });

  test("lists conversations and validates pagination", async () => {
    const repository = new InMemoryConversationRepository();
    repository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
      mustCreateConversation("conversation-2", "2026-03-16T13:00:00.000Z"),
    ]);
    const handler = createConvAgentFetchHandler(
      new CreateConversationFlow(repository, () => new Date("2026-03-16T12:00:00.000Z")),
      new GetConversationFlow(repository),
      new ListConversationsFlow(repository),
      new DeleteConversationFlow(repository),
    );

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

  test("deletes a conversation", async () => {
    const repository = new InMemoryConversationRepository();
    repository.seed([
      mustCreateConversation("conversation-1", "2026-03-16T12:00:00.000Z"),
    ]);
    const handler = createConvAgentFetchHandler(
      new CreateConversationFlow(repository, () => new Date("2026-03-16T12:00:00.000Z")),
      new GetConversationFlow(repository),
      new ListConversationsFlow(repository),
      new DeleteConversationFlow(repository),
    );

    const response = await handler(
      new Request("http://localhost/conversations/conversation-1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(204);
    expect(repository.deletedIds).toEqual(["conversation-1"]);
  });
});

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
    const conversation = this.conversations.get(id);

    if (!conversation) {
      return failure(new NotFoundError(id));
    }

    return success(conversation);
  }

  async listPage(request: ConversationPageRequest) {
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

  async deleteById(id: string) {
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
