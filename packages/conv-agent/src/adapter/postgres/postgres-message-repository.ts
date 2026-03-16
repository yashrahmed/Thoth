import type {
  CreateMessageRecord,
  MessagePageRequest,
  MessageRepository,
} from "../../domain/contracts/message-repository";
import { Message } from "../../domain/objects/message";
import { NotFoundError, StoreError, ValidationError } from "../../domain/objects/errors";
import { failure, type Result, success } from "../../domain/objects/result";
import {
  requireNonEmptyString,
  requirePositiveInteger,
  requirePresent,
} from "../../domain/validation";
import type { PostgresDatabase } from "./postgres-database";

interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly sequence_number: number;
  readonly text_content: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly file_ids: string[] | null;
}

interface CountRow {
  readonly count: number | string | bigint;
}

export class PostgresMessageRepository implements MessageRepository {
  constructor(private readonly sql: PostgresDatabase) {}

  async persistToMessageDBStore(record: CreateMessageRecord) {
    const validationResult = validateCreateRecord(record);

    if (!validationResult.ok) {
      return validationResult;
    }

    try {
      const rows = await this.sql<MessageRow[]>`
        insert into thoth.messages (
          conversation_id,
          sequence_number,
          text_content,
          created_at,
          updated_at
        )
        values (
          ${record.conversationId},
          ${record.sequenceNumber},
          ${record.textContent},
          ${record.createdAt.toISOString()},
          ${record.updatedAt.toISOString()}
        )
        returning
          id,
          conversation_id,
          sequence_number,
          text_content,
          created_at,
          updated_at,
          array[]::text[] as file_ids
      `;

      const row = rows[0];

      if (!row) {
        return failure(
          new StoreError("Message", "persist", "Message row was not returned."),
        );
      }

      if (record.fileIds.length > 0) {
        const messageId = row.id;

        for (const [index, fileId] of record.fileIds.entries()) {
          await this.sql`
            insert into thoth.message_files (
              message_id,
              file_id,
              attachment_position
            )
            values (${messageId}, ${fileId}, ${index + 1})
          `;
        }
      }

      return mapRow(
        {
          ...row,
          file_ids: [...record.fileIds],
        },
        "persist",
      );
    } catch (error) {
      return failure(new StoreError("Message", "persist", getErrorMessage(error)));
    }
  }

  async getById(id: string) {
    try {
      const rows = await this.sql<MessageRow[]>`
        select
          m.id,
          m.conversation_id,
          m.sequence_number,
          m.text_content,
          m.created_at,
          m.updated_at,
          coalesce(
            array(
              select mf.file_id
              from thoth.message_files mf
              where mf.message_id = m.id
              order by mf.attachment_position asc
            ),
            array[]::text[]
          ) as file_ids
        from thoth.messages m
        where m.id = ${id}
      `;

      const row = rows[0];

      if (!row) {
        return failure(new NotFoundError("Message", id));
      }

      return mapRow(row, "read");
    } catch (error) {
      return failure(new StoreError("Message", "read", getErrorMessage(error)));
    }
  }

  async listPageByConversation(request: MessagePageRequest) {
    const conversationIdResult = requireNonEmptyString(
      request.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const pageNumResult = requirePositiveInteger(request.pageNum, "pageNum");

    if (!pageNumResult.ok) {
      return pageNumResult;
    }

    const pageSizeResult = requirePositiveInteger(request.pageSize, "pageSize");

    if (!pageSizeResult.ok) {
      return pageSizeResult;
    }

    const fromSequence = (pageNumResult.value - 1) * pageSizeResult.value + 1;

    try {
      const rows = await this.sql<MessageRow[]>`
        select
          m.id,
          m.conversation_id,
          m.sequence_number,
          m.text_content,
          m.created_at,
          m.updated_at,
          coalesce(
            array(
              select mf.file_id
              from thoth.message_files mf
              where mf.message_id = m.id
              order by mf.attachment_position asc
            ),
            array[]::text[]
          ) as file_ids
        from thoth.messages m
        where
          m.conversation_id = ${conversationIdResult.value}
          and m.sequence_number >= ${fromSequence}
        order by m.sequence_number asc
        limit ${pageSizeResult.value}
      `;

      return mapRows(rows, "readPage");
    } catch (error) {
      return failure(new StoreError("Message", "readPage", getErrorMessage(error)));
    }
  }

  async listByConversation(conversationId: string) {
    const conversationIdResult = requireNonEmptyString(
      conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    try {
      const rows = await this.sql<MessageRow[]>`
        select
          m.id,
          m.conversation_id,
          m.sequence_number,
          m.text_content,
          m.created_at,
          m.updated_at,
          coalesce(
            array(
              select mf.file_id
              from thoth.message_files mf
              where mf.message_id = m.id
              order by mf.attachment_position asc
            ),
            array[]::text[]
          ) as file_ids
        from thoth.messages m
        where m.conversation_id = ${conversationIdResult.value}
        order by m.sequence_number asc
      `;

      return mapRows(rows, "readPage");
    } catch (error) {
      return failure(new StoreError("Message", "readPage", getErrorMessage(error)));
    }
  }

  async countByConversation(conversationId: string) {
    const conversationIdResult = requireNonEmptyString(
      conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    try {
      const rows = await this.sql<CountRow[]>`
        select count(*)::int as count
        from thoth.messages
        where conversation_id = ${conversationIdResult.value}
      `;

      const row = rows[0];

      if (!row) {
        return failure(
          new StoreError("Message", "readPage", "Message count row was not returned."),
        );
      }

      return success(Number(row.count));
    } catch (error) {
      return failure(new StoreError("Message", "readPage", getErrorMessage(error)));
    }
  }

  async deleteById(id: string) {
    try {
      await this.sql`
        delete from thoth.message_files
        where message_id = ${id}
      `;

      await this.sql`
        delete from thoth.messages
        where id = ${id}
      `;

      return success(undefined);
    } catch (error) {
      return failure(new StoreError("Message", "remove", getErrorMessage(error)));
    }
  }
}

function mapRows(
  rows: MessageRow[],
  operation: StoreError["operation"],
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
  operation: StoreError["operation"],
): Result<Message, StoreError> {
  if (!row) {
    return failure(new StoreError("Message", operation, "Message row was not returned."));
  }

  try {
    return success(
      new Message({
        id: row.id,
        conversationId: row.conversation_id,
        sequenceNumber: row.sequence_number,
        textContent: row.text_content,
        createdAt: toDate(row.created_at),
        updatedAt: toDate(row.updated_at),
        fileIds: row.file_ids ?? [],
      }),
    );
  } catch (error) {
    if (error instanceof Error) {
      return failure(new StoreError("Message", operation, error.message));
    }

    return failure(
      new StoreError("Message", operation, "Unexpected message mapping error."),
    );
  }
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected database error.";
}

function validateCreateRecord(
  record: CreateMessageRecord,
): Result<void, ValidationError> {
  const conversationIdResult = requireNonEmptyString(
    record.conversationId,
    "conversationId",
  );

  if (!conversationIdResult.ok) {
    return conversationIdResult;
  }

  const sequenceNumberResult = requirePositiveInteger(
    record.sequenceNumber,
    "sequenceNumber",
  );

  if (!sequenceNumberResult.ok) {
    return sequenceNumberResult;
  }

  const textContentResult = requirePresent(record.textContent, "textContent");

  if (!textContentResult.ok) {
    return textContentResult;
  }

  for (const fileId of record.fileIds) {
    const fileIdResult = requireNonEmptyString(fileId, "fileId");

    if (!fileIdResult.ok) {
      return fileIdResult;
    }
  }

  return success(undefined);
}
