import type { MessageRepository, ResolvedMessage } from "../../domain/contracts/message-repository";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, success, type Result } from "../../domain/objects/result";
import { getErrorMessage } from "../common/errors";
import { mapMessageRow, mapMessageRows, type MessageRow } from "../common/row-mapper";
import type { PostgresDatabase } from "./postgres-database";

interface ResolvedMessageRow extends MessageRow {
  readonly requested_id: string;
}

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async selectMessageRow(messageId: string) {
    try {
      const rows = await this.sql<MessageRow[]>`
        select
          id_bigint::text as id,
          conversation_id,
          type,
          content,
          created_at,
          updated_at
        from thoth.messages
        where id_bigint = ${messageId}::bigint
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
          id_bigint::text as id,
          conversation_id,
          type,
          content,
          created_at,
          updated_at
        from thoth.messages
        where conversation_id = ${request.conversationId}
        order by created_at asc, id_bigint asc
        limit ${request.pageSize}
        offset ${offset}
      `;

      return mapMessageRows(rows, StoreOperation.ReadPage);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.ReadPage, getErrorMessage(error)));
    }
  }

  async selectMessagesByIds(request: { readonly conversationId: string; readonly messageIds: ReadonlyArray<string> }): Promise<Result<ResolvedMessage[], StoreError>> {
    if (request.messageIds.length === 0) {
      return success([]);
    }

    try {
      const rows = await this.sql<ResolvedMessageRow[]>`
        with requested as (
          select requested_id, ordinal
          from unnest(${request.messageIds as string[]}::text[])
            with ordinality as input(requested_id, ordinal)
        )
        select
          requested.requested_id,
          m.id_bigint::text as id,
          m.conversation_id,
          m.type,
          m.content,
          m.created_at,
          m.updated_at
        from requested
        join thoth.messages as m on m.id_bigint = requested.requested_id::bigint
        where m.conversation_id = ${request.conversationId}
        order by requested.ordinal asc
      `;

      return mapResolvedRows(rows);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.ReadPage, getErrorMessage(error)));
    }
  }

  async deleteMessageRow(messageId: string) {
    try {
      await this.sql`
        delete from thoth.messages
        where id_bigint = ${messageId}::bigint
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

function mapResolvedRows(rows: ReadonlyArray<ResolvedMessageRow>): Result<ResolvedMessage[], StoreError> {
  const resolvedMessages: ResolvedMessage[] = [];

  for (const row of rows) {
    const messageResult = mapMessageRow(row, StoreOperation.ReadPage);

    if (!messageResult.ok) {
      return messageResult;
    }

    resolvedMessages.push({
      requestedId: row.requested_id,
      message: messageResult.value,
    });
  }

  return success(resolvedMessages);
}
