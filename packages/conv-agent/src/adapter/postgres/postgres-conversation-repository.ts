import type { ConversationRepository } from "../../domain/contracts/conversation-repository";
import type { Conversation } from "../../domain/objects/conversation";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, type Result, success } from "../../domain/objects/result";
import { getErrorMessage } from "../common/errors";
import { mapConversationRow, mapConversationRows, type ConversationRow } from "../common/row-mapper";
import type { PostgresDatabase } from "./postgres-database";

export class PostgresConversationRepository implements ConversationRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async upsertConversationRow(record: Omit<Conversation, "id">): Promise<Result<Conversation, StoreError>> {
    try {
      const rows = await this.sql<ConversationRow[]>`
        insert into thoth.conversations (title, created_at, updated_at)
        values (${record.title}, ${record.createdAt.toISOString()}, ${record.updatedAt.toISOString()})
        returning id, title, created_at, updated_at
      `;

      return mapConversationRow(rows[0], StoreOperation.Persist);
    } catch (error) {
      return failure(new StoreError(EntityType.Conversation, StoreOperation.Persist, getErrorMessage(error)));
    }
  }

  async selectConversationRow(conversationId: string): Promise<Result<Conversation, NotFoundError | StoreError>> {
    try {
      const rows = await this.sql<ConversationRow[]>`
        select id, title, created_at, updated_at
        from thoth.conversations
        where id = ${conversationId}
      `;

      const row = rows[0];

      if (!row) {
        return failure(new NotFoundError(EntityType.Conversation, conversationId));
      }

      return mapConversationRow(row, StoreOperation.Read);
    } catch (error) {
      return failure(new StoreError(EntityType.Conversation, StoreOperation.Read, getErrorMessage(error)));
    }
  }

  async selectConversationPage(request: { readonly pageNum: number; readonly pageSize: number }): Promise<Result<Conversation[], StoreError>> {
    try {
      const offset = (request.pageNum - 1) * request.pageSize;
      const rows = await this.sql<ConversationRow[]>`
        select id, title, created_at, updated_at
        from thoth.conversations
        order by updated_at desc, id desc
        limit ${request.pageSize}
        offset ${offset}
      `;

      return mapConversationRows(rows, StoreOperation.ReadPage);
    } catch (error) {
      return failure(new StoreError(EntityType.Conversation, StoreOperation.ReadPage, getErrorMessage(error)));
    }
  }

  async updateConversationTitleRow(request: {
    readonly conversationId: string;
    readonly title: string;
    readonly updatedAt: Date;
  }): Promise<Result<Conversation, NotFoundError | StoreError>> {
    try {
      const rows = await this.sql<ConversationRow[]>`
        update thoth.conversations
        set title = ${request.title},
            updated_at = ${request.updatedAt.toISOString()}
        where id = ${request.conversationId}
        returning id, title, created_at, updated_at
      `;

      const row = rows[0];

      if (!row) {
        return failure(new NotFoundError(EntityType.Conversation, request.conversationId));
      }

      return mapConversationRow(row, StoreOperation.Update);
    } catch (error) {
      return failure(new StoreError(EntityType.Conversation, StoreOperation.Update, getErrorMessage(error)));
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
