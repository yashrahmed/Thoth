import type { MessageRepository } from "../../domain/contracts/message-repository";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, success, type Result } from "../../domain/objects/result";
import { getErrorMessage } from "../common/errors";
import { mapMessageRow, mapMessageRows, type MessageRow } from "../common/row-mapper";
import type { PostgresDatabase } from "./postgres-database";
import type { Message } from "../../domain/objects/message-types";

interface MessagePositionRow {
  readonly id: string;
  readonly created_at: string | Date;
}

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

  async selectMessageRowByIdAndConversationId(messageId: string, conversationId: string): Promise<Result<Message, NotFoundError | StoreError>> {
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
          and conversation_id = ${conversationId}
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

  async selectMessagesUpTo(request: { readonly conversationId: string; readonly messageId: string }): Promise<Result<Message[], NotFoundError | StoreError>> {
    try {
      const targetRows = await this.sql<MessagePositionRow[]>`
        select
          id,
          created_at
        from thoth.messages
        where
          conversation_id = ${request.conversationId}
          and id = ${request.messageId}
        limit 1
      `;

      const targetRow = targetRows[0];

      if (!targetRow) {
        return failure(new NotFoundError(EntityType.Message, request.messageId));
      }

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
          and (
            created_at < ${targetRow.created_at}
            or (created_at = ${targetRow.created_at} and id <= ${targetRow.id})
          )
        order by created_at asc, id asc
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
