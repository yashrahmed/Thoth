import type { ConversationRepository } from "../../domain/contracts/conversation-repository";
import { Conversation } from "../../domain/objects/conversation";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, type Result, success } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";

interface ConversationRow {
  readonly id: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async upsertConversationRow(record: Omit<Conversation, "id">): Promise<Result<Conversation, StoreError>> {
    try {
      const rows = await this.sql<ConversationRow[]>`
        insert into thoth.conversations (created_at, updated_at)
        values (${record.createdAt.toISOString()}, ${record.updatedAt.toISOString()})
        returning id, created_at, updated_at
      `;

      return mapRow(rows[0], StoreOperation.Persist);
    } catch (error) {
      return failure(new StoreError(EntityType.Conversation, StoreOperation.Persist, getErrorMessage(error)));
    }
  }

  async selectConversationRow(conversationId: string): Promise<Result<Conversation, NotFoundError | StoreError>> {
    try {
      const rows = await this.sql<ConversationRow[]>`
        select id, created_at, updated_at
        from thoth.conversations
        where id = ${conversationId}
      `;

      const row = rows[0];

      if (!row) {
        return failure(new NotFoundError(EntityType.Conversation, conversationId));
      }

      return mapRow(row, StoreOperation.Read);
    } catch (error) {
      return failure(new StoreError(EntityType.Conversation, StoreOperation.Read, getErrorMessage(error)));
    }
  }

  async selectConversationPage(request: { readonly pageNum: number; readonly pageSize: number }): Promise<Result<Conversation[], StoreError>> {
    try {
      const offset = (request.pageNum - 1) * request.pageSize;
      const rows = await this.sql<ConversationRow[]>`
        select id, created_at, updated_at
        from thoth.conversations
        order by updated_at desc, id desc
        limit ${request.pageSize}
        offset ${offset}
      `;

      const conversations: Conversation[] = [];

      for (const row of rows) {
        const conversationResult = mapRow(row, StoreOperation.ReadPage);

        if (!conversationResult.ok) {
          return conversationResult;
        }

        conversations.push(conversationResult.value);
      }

      return success(conversations);
    } catch (error) {
      return failure(new StoreError(EntityType.Conversation, StoreOperation.ReadPage, getErrorMessage(error)));
    }
  }

  async deleteConversationRow(conversationId: string): Promise<Result<void, StoreError>> {
    try {
      await this.sql`
        delete from thoth.conversations
        where id = ${conversationId}
      `;

      return success(undefined);
    } catch (error) {
      return failure(new StoreError(EntityType.Conversation, StoreOperation.Remove, getErrorMessage(error)));
    }
  }
}

function mapRow(row: ConversationRow | undefined, operation: StoreOperation): Result<Conversation, StoreError> {
  if (!row) {
    return failure(new StoreError(EntityType.Conversation, operation, "Conversation row was not returned."));
  }

  try {
    return success(new Conversation(row.id, toDate(row.created_at), toDate(row.updated_at)));
  } catch (error) {
    if (error instanceof Error) {
      return failure(new StoreError(EntityType.Conversation, operation, error.message));
    }

    return failure(new StoreError(EntityType.Conversation, operation, "Unexpected conversation mapping error."));
  }
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected database error.";
}
