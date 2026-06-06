import type { AppendUserMessageStore, PersistMessagesInput, PersistUserMessageWithFilesInput } from "../../domain/contracts/append-user-message-store";
import { EntityType, StoreError, StoreOperation, ValidationError } from "../../domain/objects/errors";
import { type AppendMessageRecord, Message } from "../../domain/objects/message-types";
import { failure, success, type Result } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";

interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly parent_message_id: string | null;
  readonly path: string | null;
  readonly child_count: number;
  readonly type: AppendMessageRecord["type"];
  readonly sequence_number: number;
  readonly content: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

interface ConversationRow {
  readonly id: string;
}

export class PostgresAppendUserMessageStore implements AppendUserMessageStore {
  constructor(private readonly sql: PostgresDatabase) {}

  async persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<Message, ValidationError | StoreError>> {
    try {
      const row = await this.sql.begin(async (tx) => {
        const sql = tx as unknown as PostgresDatabase;
        const timestamp = new Date();
        const latestSequenceNumber = await lockConversationAndGetLatestSequenceNumber(sql, input.message.conversationId);
        const sequenceNumber = latestSequenceNumber + 1;

        const messageRows = await sql<MessageRow[]>`
          insert into thoth.messages (
            conversation_id,
            parent_message_id,
            path,
            type,
            sequence_number,
            content,
            created_at,
            updated_at
          )
          values (
            ${input.message.conversationId},
            ${input.message.parentMessageId ?? null},
            ${input.message.path ?? null},
            ${input.message.type},
            ${sequenceNumber},
            ${input.message.content},
            ${input.message.createdAt.toISOString()},
            ${input.message.updatedAt.toISOString()}
          )
          returning
            id,
            conversation_id,
            parent_message_id,
            path,
            child_count,
            type,
            sequence_number,
            content,
            created_at,
            updated_at
        `;

        const messageRow = messageRows[0];

        if (!messageRow) {
          throw new Error("Message row was not returned.");
        }

        for (const file of input.files) {
          await sql`
            insert into thoth.files (
              message_id,
              canonical_url,
              filename,
              mime_type,
              size_in_bytes,
              created_at,
              updated_at
            )
            values (
              ${messageRow.id},
              ${file.canonicalUrl},
              ${file.filename},
              ${file.mimeType},
              ${file.sizeInBytes},
              ${timestamp.toISOString()},
              ${timestamp.toISOString()}
            )
          `;
        }

        return messageRow;
      });

      return mapMessageRow(row);
    } catch (error) {
      if (error instanceof ValidationError) {
        return failure(error);
      }

      if (isUniqueSequenceConstraintViolation(error)) {
        return failure(new ValidationError("sequenceNumber", "next message sequenceNumber is no longer available."));
      }

      return failure(new StoreError(EntityType.Message, StoreOperation.Persist, getErrorMessage(error)));
    }
  }

  async persistMessages(input: PersistMessagesInput): Promise<Result<Message[], ValidationError | StoreError>> {
    const firstMessage = input.messages[0];

    if (!firstMessage) {
      return success([]);
    }

    try {
      const rows = await this.sql.begin(async (tx) => {
        const sql = tx as unknown as PostgresDatabase;
        const messageRows: MessageRow[] = [];

        for (const message of input.messages) {
          if (message.conversationId !== firstMessage.conversationId) {
            throw new ValidationError("conversationId", "messages must belong to the same conversation.");
          }
        }

        const latestSequenceNumber = await lockConversationAndGetLatestSequenceNumber(sql, firstMessage.conversationId);

        for (const [index, message] of input.messages.entries()) {
          const sequenceNumber = latestSequenceNumber + index + 1;

          const rows = await sql<MessageRow[]>`
            insert into thoth.messages (
              conversation_id,
              parent_message_id,
              path,
              type,
              sequence_number,
              content,
              created_at,
              updated_at
            )
            values (
              ${message.conversationId},
              ${message.parentMessageId ?? null},
              ${message.path ?? null},
              ${message.type},
              ${sequenceNumber},
              ${message.content},
              ${message.createdAt.toISOString()},
              ${message.updatedAt.toISOString()}
            )
            returning
              id,
              conversation_id,
              parent_message_id,
              path,
              child_count,
              type,
              sequence_number,
              content,
              created_at,
              updated_at
          `;

          const messageRow = rows[0];

          if (!messageRow) {
            throw new Error("Message row was not returned.");
          }

          messageRows.push(messageRow);
        }

        return messageRows;
      });

      return mapMessageRows(rows);
    } catch (error) {
      if (error instanceof ValidationError) {
        return failure(error);
      }

      if (isUniqueSequenceConstraintViolation(error)) {
        return failure(new ValidationError("sequenceNumber", "one or more next message sequenceNumbers are no longer available."));
      }

      return failure(new StoreError(EntityType.Message, StoreOperation.Persist, getErrorMessage(error)));
    }
  }
}

async function lockConversationAndGetLatestSequenceNumber(sql: PostgresDatabase, conversationId: string): Promise<number> {
  const conversationRows = await sql<ConversationRow[]>`
    select id
    from thoth.conversations
    where id = ${conversationId}
    for no key update
  `;

  if (!conversationRows[0]) {
    throw new Error(`Conversation ${conversationId} was not found while allocating message sequence.`);
  }

  const latestSequenceRows = await sql<{ latest_sequence_number: number | string | bigint }[]>`
    select coalesce(max(sequence_number), 0)::int as latest_sequence_number
    from thoth.messages
    where conversation_id = ${conversationId}
  `;

  const latestSequenceRow = latestSequenceRows[0];

  if (!latestSequenceRow) {
    throw new Error("Latest message sequence row was not returned.");
  }

  return Number(latestSequenceRow.latest_sequence_number);
}

function mapMessageRows(rows: MessageRow[]): Result<Message[], StoreError> {
  const messages: Message[] = [];

  for (const row of rows) {
    const messageResult = mapMessageRow(row);

    if (!messageResult.ok) {
      return messageResult;
    }

    messages.push(messageResult.value);
  }

  return success(messages);
}

function mapMessageRow(row: MessageRow | undefined): Result<Message, StoreError> {
  if (!row) {
    return failure(new StoreError(EntityType.Message, StoreOperation.Persist, "Message row was not returned."));
  }

  try {
    return success(
      new Message(
        row.id,
        row.conversation_id,
        row.type,
        row.sequence_number,
        row.content,
        toDate(row.created_at),
        toDate(row.updated_at),
        row.parent_message_id,
        row.path,
        row.child_count,
      ),
    );
  } catch (error) {
    if (error instanceof Error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.Persist, error.message));
    }

    return failure(new StoreError(EntityType.Message, StoreOperation.Persist, "Unexpected message mapping error."));
  }
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected database error.";
}

function isUniqueSequenceConstraintViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
