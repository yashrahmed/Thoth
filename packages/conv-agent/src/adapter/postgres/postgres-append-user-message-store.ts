import type { AppendUserMessageStore, PersistUserMessageWithFilesInput } from "../../domain/contracts/append-user-message-store";
import { EntityType, StoreError, StoreOperation, ValidationError } from "../../domain/objects/errors";
import { Message } from "../../domain/objects/message";
import { failure, success, type Result } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";

interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly type: PersistUserMessageWithFilesInput["message"]["type"];
  readonly sequence_number: number;
  readonly content: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export class PostgresAppendUserMessageStore implements AppendUserMessageStore {
  constructor(private readonly sql: PostgresDatabase) {}

  async persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<Message, ValidationError | StoreError>> {
    try {
      const row = await this.sql.begin(async (tx) => {
        const sql = tx as unknown as PostgresDatabase;
        const timestamp = new Date();

        const latestSequenceRows = await sql<{ latest_sequence_number: number | string | bigint }[]>`
          select coalesce(max(sequence_number), 0)::int as latest_sequence_number
          from thoth.messages
          where conversation_id = ${input.message.conversationId}
        `;

        const latestSequenceRow = latestSequenceRows[0];

        if (!latestSequenceRow) {
          throw new Error("Latest message sequence row was not returned.");
        }

        const expectedPreviousSequenceNumber = input.message.sequenceNumber - 1;
        const latestSequenceNumber = Number(latestSequenceRow.latest_sequence_number);

        if (latestSequenceNumber !== expectedPreviousSequenceNumber) {
          throw new ValidationError(
            "sequenceNumber",
            `sequenceNumber must append after ${latestSequenceNumber}; received ${input.message.sequenceNumber}.`,
          );
        }

        const messageRows = await sql<MessageRow[]>`
          insert into thoth.messages (
            conversation_id,
            type,
            sequence_number,
            content,
            created_at,
            updated_at
          )
          values (
            ${input.message.conversationId},
            ${input.message.type},
            ${input.message.sequenceNumber},
            ${input.message.content},
            ${input.message.createdAt.toISOString()},
            ${input.message.updatedAt.toISOString()}
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
        return failure(new ValidationError("sequenceNumber", `sequenceNumber ${input.message.sequenceNumber} is no longer available.`));
      }

      return failure(new StoreError(EntityType.Message, StoreOperation.Persist, getErrorMessage(error)));
    }
  }
}

function mapMessageRow(row: MessageRow | undefined): Result<Message, StoreError> {
  if (!row) {
    return failure(new StoreError(EntityType.Message, StoreOperation.Persist, "Message row was not returned."));
  }

  try {
    return success(new Message(row.id, row.conversation_id, row.type, row.sequence_number, row.content, toDate(row.created_at), toDate(row.updated_at)));
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
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
