import type {
  CreateConversationRecord,
  ConversationPageRequest,
  ConversationRepository,
} from "../../domain/contracts/conversation-repository";
import { Conversation } from "../../domain/objects/conversation";
import {
  NotFoundError,
  StoreError,
} from "../../domain/objects/errors";
import { failure, type Result, success } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";

interface ConversationRow {
  readonly id: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async create(
    record: CreateConversationRecord,
  ): Promise<Result<Conversation, StoreError>> {
    try {
      const rows = await this.sql<ConversationRow[]>`
        insert into thoth.conversations (created_at, updated_at)
        values (${record.createdAt.toISOString()}, ${record.updatedAt.toISOString()})
        returning id, created_at, updated_at
      `;

      return mapRow(rows[0], "persist");
    } catch (error) {
      return failure(new StoreError("Conversation", "persist", getErrorMessage(error)));
    }
  }

  async getById(
    id: string,
  ): Promise<Result<Conversation, NotFoundError | StoreError>> {
    try {
      const rows = await this.sql<ConversationRow[]>`
        select id, created_at, updated_at
        from thoth.conversations
        where id = ${id}
      `;

      const row = rows[0];

      if (!row) {
        return failure(new NotFoundError("Conversation", id));
      }

      return mapRow(row, "read");
    } catch (error) {
      return failure(new StoreError("Conversation", "read", getErrorMessage(error)));
    }
  }

  async listPage(
    request: ConversationPageRequest,
  ): Promise<Result<Conversation[], StoreError>> {
    try {
      const rows = await this.sql<ConversationRow[]>`
        select id, created_at, updated_at
        from thoth.conversations
        order by updated_at desc, id desc
        limit ${request.limit}
        offset ${request.offset}
      `;

      const conversations: Conversation[] = [];

      for (const row of rows) {
        const conversationResult = mapRow(row, "readPage");

        if (!conversationResult.ok) {
          return conversationResult;
        }

        conversations.push(conversationResult.value);
      }

      return success(conversations);
    } catch (error) {
      return failure(
        new StoreError("Conversation", "readPage", getErrorMessage(error)),
      );
    }
  }

  async deleteById(id: string): Promise<Result<void, StoreError>> {
    try {
      await this.sql`
        delete from thoth.conversations
        where id = ${id}
      `;

      return success(undefined);
    } catch (error) {
      return failure(new StoreError("Conversation", "remove", getErrorMessage(error)));
    }
  }
}

function mapRow(
  row: ConversationRow | undefined,
  operation: StoreError["operation"],
): Result<Conversation, StoreError> {
  if (!row) {
    return failure(
      new StoreError("Conversation", operation, "Conversation row was not returned."),
    );
  }

  try {
    return success(
      new Conversation({
        id: row.id,
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
      }),
    );
  } catch (error) {
    if (error instanceof Error) {
      return failure(new StoreError("Conversation", operation, error.message));
    }

    return failure(
      new StoreError(
        "Conversation",
        operation,
        "Unexpected conversation mapping error.",
      ),
    );
  }
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected database error.";
}
