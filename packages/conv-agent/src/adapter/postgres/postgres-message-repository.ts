import type {
  CreateMessageRecord,
  MessageRepository,
  MessageSequencePageRequest,
} from "../../domain/contracts/message-repository";
import { Message } from "../../domain/objects/message";
import { type LLMMessageType } from "../../domain/objects/llm";
import {
  EntityType,
  NotFoundError,
  StoreError,
  StoreOperation,
} from "../../domain/objects/errors";
import { failure, type Result, success } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";
import type { ContentPart, ToolCall } from "../../domain/objects/message-content";

interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly type: LLMMessageType;
  readonly sequence_number: number;
  readonly content: ContentPart[];
  readonly tool_calls: ToolCall[];
  readonly tool_call_id: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly file_ids: string[];
}

interface CountRow {
  readonly count: number | string | bigint;
}

type JsonValue =
  | string
  | number
  | boolean
  | null
  | { readonly [key: string]: JsonValue }
  | JsonValue[];

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async upsertMessageRow(record: CreateMessageRecord) {
    try {
      const rows = await this.sql<MessageRow[]>`
        insert into thoth.messages (
          conversation_id,
          type,
          sequence_number,
          content,
          tool_calls,
          tool_call_id,
          file_ids,
          created_at,
          updated_at
        )
        values (
          ${record.conversationId},
          ${record.type},
          ${record.sequenceNumber},
          ${this.sql.json(toJsonValue(record.content))},
          ${this.sql.json(toJsonValue(record.toolCalls))},
          ${record.toolCallId},
          ${record.fileIds},
          ${record.createdAt.toISOString()},
          ${record.updatedAt.toISOString()}
        )
        returning
          id,
          conversation_id,
          type,
          sequence_number,
          content,
          tool_calls,
          tool_call_id,
          file_ids,
          created_at,
          updated_at
      `;

      const row = rows[0];

      if (!row) {
        return failure(
          new StoreError(
            EntityType.Message,
            StoreOperation.Persist,
            "Message row was not returned.",
          ),
        );
      }

      return mapRow(row, StoreOperation.Persist);
    } catch (error) {
      return failure(
        new StoreError(
          EntityType.Message,
          StoreOperation.Persist,
          getErrorMessage(error),
        ),
      );
    }
  }

  async selectMessageRow(messageId: string) {
    try {
      const rows = await this.sql<MessageRow[]>`
        select
          id,
          conversation_id,
          type,
          sequence_number,
          content,
          tool_calls,
          tool_call_id,
          file_ids,
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
      return failure(
        new StoreError(EntityType.Message, StoreOperation.Read, getErrorMessage(error)),
      );
    }
  }

  async selectMessagePage(request: MessageSequencePageRequest) {
    try {
      const rows = await this.sql<MessageRow[]>`
        select
          id,
          conversation_id,
          type,
          sequence_number,
          content,
          tool_calls,
          tool_call_id,
          file_ids,
          created_at,
          updated_at
        from thoth.messages
        where
          conversation_id = ${request.conversationId}
          and sequence_number >= ${request.fromSequence}
        order by sequence_number asc
        limit ${request.pageSize}
      `;

      return mapRows(rows, StoreOperation.ReadPage);
    } catch (error) {
      return failure(
        new StoreError(
          EntityType.Message,
          StoreOperation.ReadPage,
          getErrorMessage(error),
        ),
      );
    }
  }

  async selectAllMessagesByConversation(conversationId: string) {
    try {
      const rows = await this.sql<MessageRow[]>`
        select
          id,
          conversation_id,
          type,
          sequence_number,
          content,
          tool_calls,
          tool_call_id,
          file_ids,
          created_at,
          updated_at
        from thoth.messages
        where conversation_id = ${conversationId}
        order by sequence_number asc
      `;

      return mapRows(rows, StoreOperation.ReadPage);
    } catch (error) {
      return failure(
        new StoreError(
          EntityType.Message,
          StoreOperation.ReadPage,
          getErrorMessage(error),
        ),
      );
    }
  }

  async countMessagesByConversation(conversationId: string) {
    try {
      const rows = await this.sql<CountRow[]>`
        select count(*)::int as count
        from thoth.messages
        where conversation_id = ${conversationId}
      `;

      const row = rows[0];

      if (!row) {
        return failure(
          new StoreError(
            EntityType.Message,
            StoreOperation.ReadPage,
            "Message count row was not returned.",
          ),
        );
      }

      return success(Number(row.count));
    } catch (error) {
      return failure(
        new StoreError(
          EntityType.Message,
          StoreOperation.ReadPage,
          getErrorMessage(error),
        ),
      );
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
      return failure(
        new StoreError(
          EntityType.Message,
          StoreOperation.Remove,
          getErrorMessage(error),
        ),
      );
    }
  }
}

function mapRows(
  rows: MessageRow[],
  operation: StoreOperation,
): Result<Message[], StoreError> {
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

function mapRow(
  row: MessageRow | undefined,
  operation: StoreOperation,
): Result<Message, StoreError> {
  if (!row) {
    return failure(
      new StoreError(EntityType.Message, operation, "Message row was not returned."),
    );
  }

  try {
    return success(
      new Message({
        id: row.id,
        conversationId: row.conversation_id,
        type: row.type,
        sequenceNumber: row.sequence_number,
        content: row.content,
        toolCalls: row.tool_calls,
        toolCallId: row.tool_call_id,
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
        fileIds: row.file_ids,
      }),
    );
  } catch (error) {
    if (error instanceof Error) {
      return failure(new StoreError(EntityType.Message, operation, error.message));
    }

    return failure(
      new StoreError(
        EntityType.Message,
        operation,
        "Unexpected message mapping error.",
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

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
