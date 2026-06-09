import type { MessageRepository } from "../../domain/contracts/message-repository";
import { type LLMMessageType } from "../../domain/objects/llm";
import { EntityType, NotFoundError, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, success, type Result } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";
import { Message } from "../../domain/objects/message-types";

interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly parent_message_id: string | null;
  readonly child_count: number;
  readonly type: LLMMessageType;
  readonly content: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

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

      return mapRow(row, StoreOperation.Read);
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

      return mapRow(row, StoreOperation.Read);
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

      return mapRows(rows, StoreOperation.ReadPage);
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

      return mapRows(rows, StoreOperation.ReadPage);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.ReadPage, getErrorMessage(error)));
    }
  }

  async selectAllMessagesByConversation(conversationId: string) {
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
        where conversation_id = ${conversationId}
        order by created_at asc, id asc
      `;

      return mapRows(rows, StoreOperation.ReadPage);
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

function mapRows(rows: MessageRow[], operation: StoreOperation): Result<Message[], StoreError> {
  const messages: Message[] = [];

  for (const row of rows) {
    const messageResult = mapRow(row, operation);

    if (!messageResult.ok) {
      return messageResult;
    }

    messages.push(messageResult.value);
  }

  return success(messages);
}

function mapRow(row: MessageRow | undefined, operation: StoreOperation): Result<Message, StoreError> {
  if (!row) {
    return failure(new StoreError(EntityType.Message, operation, "Message row was not returned."));
  }

  try {
    return success(new Message(row.id, row.conversation_id, row.type, row.content, toDate(row.created_at), toDate(row.updated_at), row.parent_message_id, row.child_count));
  } catch (error) {
    if (error instanceof Error) {
      return failure(new StoreError(EntityType.Message, operation, error.message));
    }

    return failure(new StoreError(EntityType.Message, operation, "Unexpected message mapping error."));
  }
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected database error.";
}
