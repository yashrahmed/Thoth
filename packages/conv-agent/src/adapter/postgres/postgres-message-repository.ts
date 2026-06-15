import type { MessageRepository } from "../../domain/contracts/message-repository";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, success, type Result } from "../../domain/objects/result";
import { getErrorMessage } from "../common/errors";
import { mapMessageRow, mapMessageRows, type MessageRow } from "../common/row-mapper";
import type { PostgresDatabase } from "./postgres-database";
import type { Message } from "../../domain/objects/message-types";

interface MessagePathRow {
  readonly path: string;
  readonly depth: number;
}

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async selectMessageRow(messageId: string) {
    try {
      const rows = await this.sql<MessageRow[]>`
        select
          id,
          conversation_id,
          parent_message_id,
          child_count,
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
          parent_message_id,
          child_count,
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

  async selectLeafMessagesByConversation(conversationId: string) {
    try {
      const rows = await this.sql<MessageRow[]>`
        select
          id,
          conversation_id,
          parent_message_id,
          child_count,
          type,
          content,
          created_at,
          updated_at
        from thoth.messages
        where
          conversation_id = ${conversationId}
          and path is not null
          and child_count = 0
        order by
          thoth.nlevel(path) desc,
          string_to_array(path::text, '.')::integer[] asc
      `;

      return mapMessageRows(rows, StoreOperation.ReadPage);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.ReadPage, getErrorMessage(error)));
    }
  }

  async selectMessagePageForLeaf(request: { readonly conversationId: string; readonly leafMessageId: string; readonly pageNum: number; readonly pageSize: number }) {
    try {
      const leafPathRows = await this.sql<MessagePathRow[]>`
        select
          path::text as path,
          thoth.nlevel(path) as depth
        from thoth.messages
        where
          conversation_id = ${request.conversationId}
          and id = ${request.leafMessageId}
          and path is not null
        limit 1
      `;

      const leafPathRow = leafPathRows[0];

      if (!leafPathRow) {
        return success([]);
      }

      const { startDepth, endDepth } = calculateDepthPageWindow(request.pageNum, request.pageSize);
      const rows = await this.sql<MessageRow[]>`
        select
          id,
          conversation_id,
          parent_message_id,
          child_count,
          type,
          content,
          created_at,
          updated_at
        from thoth.messages
        where
          conversation_id = ${request.conversationId}
          and path OPERATOR(thoth.@>) ${leafPathRow.path}::thoth.ltree
          and thoth.nlevel(path) between ${startDepth} and ${endDepth}
        order by thoth.nlevel(path) asc
      `;

      return mapMessageRows(rows, StoreOperation.ReadPage);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.ReadPage, getErrorMessage(error)));
    }
  }

  async selectAncestorMessages(request: { readonly conversationId: string; readonly messageId: string }): Promise<Result<Message[], NotFoundError | StoreError>> {
    try {
      const leafPathRows = await this.sql<MessagePathRow[]>`
        select
          path::text as path,
          thoth.nlevel(path) as depth
        from thoth.messages
        where
          conversation_id = ${request.conversationId}
          and id = ${request.messageId}
          and path is not null
        limit 1
      `;

      const leafPathRow = leafPathRows[0];

      if (!leafPathRow) {
        return failure(new NotFoundError(EntityType.Message, request.messageId));
      }

      const rows = await this.sql<MessageRow[]>`
        select
          id,
          conversation_id,
          parent_message_id,
          child_count,
          type,
          content,
          created_at,
          updated_at
        from thoth.messages
        where
          conversation_id = ${request.conversationId}
          and path OPERATOR(thoth.@>) ${leafPathRow.path}::thoth.ltree
        order by thoth.nlevel(path) asc
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

function calculateDepthPageWindow(pageNum: number, pageSize: number): { readonly startDepth: number; readonly endDepth: number } {
  const startDepth = (pageNum - 1) * pageSize + 1;
  const endDepth = pageNum * pageSize;

  return { startDepth, endDepth };
}
