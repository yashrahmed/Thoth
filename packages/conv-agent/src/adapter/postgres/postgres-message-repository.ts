import type { MessageRepository } from "../../domain/contracts/message-repository";
import { type LLMMessageType } from "../../domain/objects/llm";
import { EntityType, NotFoundError, StoreError, StoreOperation, ValidationError } from "../../domain/objects/errors";
import { failure, success, type Result } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";
import { type InsertNextMessageRecord, Message } from "../../domain/objects/message";

interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly type: LLMMessageType;
  readonly sequence_number: number;
  readonly content: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async insertNextMessageRow(record: InsertNextMessageRecord) {
    try {
      const row = await this.sql.begin(async (tx) => {
        const sql = tx as unknown as PostgresDatabase;

        const latestSequenceRows = await sql<{ latest_sequence_number: number | string | bigint }[]>`
          select coalesce(max(sequence_number), 0)::int as latest_sequence_number
          from thoth.messages
          where conversation_id = ${record.conversationId}
        `;

        const latestSequenceRow = latestSequenceRows[0];

        if (!latestSequenceRow) {
          throw new Error("Latest message sequence row was not returned.");
        }

        const expectedPreviousSequenceNumber = record.sequenceNumber - 1;
        const latestSequenceNumber = Number(latestSequenceRow.latest_sequence_number);

        if (latestSequenceNumber !== expectedPreviousSequenceNumber) {
          throw new ValidationError(
            "sequenceNumber",
            `sequenceNumber must append after ${latestSequenceNumber}; received ${record.sequenceNumber}.`,
          );
        }

        const rows = await sql<MessageRow[]>`
          insert into thoth.messages (
            conversation_id,
            type,
            sequence_number,
            content,
            created_at,
            updated_at
          )
          values (
            ${record.conversationId},
            ${record.type},
            ${record.sequenceNumber},
            ${record.content},
            ${record.createdAt.toISOString()},
            ${record.updatedAt.toISOString()}
          )
          returning
            id,
            conversation_id,
            type,
            sequence_number,
            content,
            created_at,
            updated_at
        `;

        return rows[0];
      });

      return mapRow(row, StoreOperation.Persist);
    } catch (error) {
      if (error instanceof ValidationError) {
        return failure(error);
      }

      if (isUniqueSequenceConstraintViolation(error)) {
        return failure(new ValidationError("sequenceNumber", `sequenceNumber ${record.sequenceNumber} is no longer available.`));
      }

      return failure(new StoreError(EntityType.Message, StoreOperation.Persist, getErrorMessage(error)));
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

  async selectMessagePage(request: { readonly conversationId: string; readonly pageNum: number; readonly pageSize: number }) {
    try {
      const fromSequence = (request.pageNum - 1) * request.pageSize + 1;
      const rows = await this.sql<MessageRow[]>`
        select
          id,
          conversation_id,
          type,
          sequence_number,
          content,
          created_at,
          updated_at
        from thoth.messages
        where
          conversation_id = ${request.conversationId}
          and sequence_number >= ${fromSequence}
        order by sequence_number asc
        limit ${request.pageSize}
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
          type,
          sequence_number,
          content,
          created_at,
          updated_at
        from thoth.messages
        where conversation_id = ${conversationId}
        order by sequence_number asc
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
    return success(new Message(row.id, row.conversation_id, row.type, row.sequence_number, row.content, toDate(row.created_at), toDate(row.updated_at)));
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

function isUniqueSequenceConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
