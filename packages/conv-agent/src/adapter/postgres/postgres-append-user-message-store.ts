import type { AppendUserMessageStore, PersistUserMessageWithFilesInput } from "../../domain/contracts/append-user-message-store";
import { EntityType, StoreError, StoreOperation } from "../../domain/objects/errors";
import { Message } from "../../domain/objects/message";
import { failure, success, type Result } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";

interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly type: PersistUserMessageWithFilesInput["type"];
  readonly sequence_number: number;
  readonly content: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export class PostgresAppendUserMessageStore implements AppendUserMessageStore {
  constructor(private readonly sql: PostgresDatabase) {}

  async persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<Message, StoreError>> {
    try {
      const row = await this.sql.begin(async (tx) => {
        const sql = tx as unknown as PostgresDatabase;
        const timestamp = new Date();

        const lockedConversationRows = await sql<{ id: string }[]>`
          select id
          from thoth.conversations
          where id = ${input.conversationId}
          for update
        `;

        if (!lockedConversationRows[0]) {
          throw new Error("Conversation row could not be locked.");
        }

        const nextSequenceRows = await sql<{ next_sequence_number: number | string | bigint }[]>`
          select coalesce(max(sequence_number), 0)::int + 1 as next_sequence_number
          from thoth.messages
          where conversation_id = ${input.conversationId}
        `;

        const nextSequenceRow = nextSequenceRows[0];

        if (!nextSequenceRow) {
          throw new Error("Next message sequence row was not returned.");
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
            ${input.conversationId},
            ${input.type},
            ${Number(nextSequenceRow.next_sequence_number)},
            ${input.content},
            ${timestamp.toISOString()},
            ${timestamp.toISOString()}
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
