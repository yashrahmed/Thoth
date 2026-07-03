import type { MessageRepository } from "../../domain/contracts/message-repository";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, success, type Result } from "../../domain/objects/result";
import { getErrorMessage } from "../common/errors";
import { mapMessageRow, mapMessageRows, type MessageRow } from "../common/row-mapper";
import type { PostgresDatabase } from "./postgres-database";
import type { Message } from "../../domain/objects/message-types";

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async selectMessageRow(messageId: string) {
    try {
      const rows = await this.sql<MessageRow[]>`
        select
          id,
          conversation_id,
          type,
          content,
          created_at,
          updated_at
        from thoth.messages
        where id = ${messageId}
      `;

      const row = rows[0];

      if (!row) {
        return failure(new NotFoundError(EntityType.Message, messageId));
      }

      return mapMessageRow(row, StoreOperation.Read);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.Read, getErrorMessage(error)));
    }
  }

  async selectMessagePage(request: { readonly conversationId: string; readonly pageNum: number; readonly pageSize: number }) {
    try {
      const offset = (request.pageNum - 1) * request.pageSize;
      const rows = await this.sql<MessageRow[]>`
        select
          id,
          conversation_id,
          type,
          content,
          created_at,
          updated_at
        from thoth.messages
        where conversation_id = ${request.conversationId}
        order by created_at asc, id asc
        limit ${request.pageSize}
        offset ${offset}
      `;

      return mapMessageRows(rows, StoreOperation.ReadPage);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.ReadPage, getErrorMessage(error)));
    }
  }

  async selectMessagesByIds(request: { readonly conversationId: string; readonly messageIds: ReadonlyArray<string> }): Promise<Result<Message[], StoreError>> {
    if (request.messageIds.length === 0) {
      return success([]);
    }

    try {
      const rows = await this.sql<MessageRow[]>`
        select
          id,
          conversation_id,
          type,
          content,
          created_at,
          updated_at
        from thoth.messages
        where
          conversation_id = ${request.conversationId}
          and id = any(${request.messageIds as string[]})
      `;

      return mapMessageRows(rows, StoreOperation.ReadPage);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.ReadPage, getErrorMessage(error)));
    }
  }

  async deleteMessageRow(messageId: string) {
    try {
      await this.sql`
        delete from thoth.messages
        where id = ${messageId}
      `;

      return success(undefined);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.Remove, getErrorMessage(error)));
    }
  }
  async deleteMessagesByConversation(conversationId: string) {
    try {
      await this.sql`
        delete from thoth.messages
        where conversation_id = ${conversationId}
      `;

      return success(undefined);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.Remove, getErrorMessage(error)));
    }
  }
}
