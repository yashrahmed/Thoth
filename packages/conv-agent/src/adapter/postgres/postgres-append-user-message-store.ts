import type { AppendUserMessageStore, PersistUserMessageWithFilesInput } from "../../domain/contracts/append-user-message-store";
import type { MessageIdResponseMode } from "../../config/config";
import { EntityType, StoreError, StoreOperation } from "../../domain/objects/errors";
import type { MessageWithFiles } from "../../domain/objects/message-types";
import { failure, success, type Result } from "../../domain/objects/result";
import { getErrorMessage } from "../common/errors";
import { mapFileRows, mapMessageRow, type FileRow, type MessageRow } from "../common/row-mapper";
import type { PostgresDatabase } from "./postgres-database";

interface MessageWithFilesRow {
  readonly message: MessageRow;
  readonly files: FileRow[];
}

interface TransitionalMessageRow extends MessageRow {
  readonly legacy_id: string;
  readonly bigint_id: string;
}

export class PostgresAppendUserMessageStore implements AppendUserMessageStore {
  constructor(
    private readonly sql: PostgresDatabase,
    private readonly messageIdResponseMode: MessageIdResponseMode,
  ) {}

  async persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<MessageWithFiles, StoreError>> {
    try {
      const row = await this.sql.begin(async (tx) => {
        const sql = tx as unknown as PostgresDatabase;
        const timestamp = new Date();

        const messageRows = await sql<TransitionalMessageRow[]>`
          insert into thoth.messages (
            conversation_id,
            type,
            content,
            created_at,
            updated_at
          )
          values (
            ${input.message.conversationId},
            ${input.message.type},
            ${input.message.content},
            ${input.message.createdAt.toISOString()},
            ${input.message.updatedAt.toISOString()}
          )
          returning
            case when ${this.messageIdResponseMode} = 'uuid' then id else id_bigint::text end as id,
            id as legacy_id,
            id_bigint::text as bigint_id,
            conversation_id,
            type,
            content,
            created_at,
            updated_at
        `;

        const messageRow = messageRows[0];

        if (!messageRow) {
          throw new Error("Message row was not returned.");
        }

        const fileRows: FileRow[] = [];

        for (const file of input.files) {
          const insertedFileRows = await sql<FileRow[]>`
            insert into thoth.files (
              message_id,
              message_id_bigint,
              canonical_url,
              filename,
              mime_type,
              size_in_bytes,
              created_at,
              updated_at
            )
            values (
              ${messageRow.legacy_id},
              ${messageRow.bigint_id},
              ${file.canonicalUrl},
              ${file.filename},
              ${file.mimeType},
              ${file.sizeInBytes},
              ${timestamp.toISOString()},
              ${timestamp.toISOString()}
            )
            returning
              id,
              case when ${this.messageIdResponseMode} = 'uuid' then message_id else message_id_bigint::text end as message_id,
              canonical_url,
              filename,
              mime_type,
              size_in_bytes,
              created_at,
              updated_at
          `;

          const insertedFileRow = insertedFileRows[0];

          if (!insertedFileRow) {
            throw new Error("File row was not returned.");
          }

          fileRows.push(insertedFileRow);
        }

        return { message: messageRow, files: fileRows };
      });

      return mapMessageWithFilesRow(row);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.Persist, getErrorMessage(error)));
    }
  }
}

function mapMessageWithFilesRow(row: MessageWithFilesRow): Result<MessageWithFiles, StoreError> {
  const messageResult = mapMessageRow(row.message, StoreOperation.Persist);

  if (!messageResult.ok) {
    return messageResult;
  }

  const filesResult = mapFileRows(row.files, StoreOperation.Persist);

  if (!filesResult.ok) {
    return filesResult;
  }

  return success({
    ...messageResult.value,
    files: filesResult.value,
  });
}
