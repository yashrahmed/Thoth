import type { AppendUserMessageStore, PersistMessagesInput, PersistUserMessageWithFilesInput } from "../../domain/contracts/append-user-message-store";
import { EntityType, StoreError, StoreOperation, ValidationError } from "../../domain/objects/errors";
import { type AppendMessageRecord, File, Message, type MessageWithFiles } from "../../domain/objects/message-types";
import { failure, success, type Result } from "../../domain/objects/result";
import type { PostgresDatabase } from "./postgres-database";

interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly parent_message_id: string | null;
  readonly child_count: number;
  readonly type: AppendMessageRecord["type"];
  readonly content: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

interface FileRow {
  readonly id: string;
  readonly message_id: string;
  readonly canonical_url: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly size_in_bytes: number;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

interface MessageWithFilesRow {
  readonly message: MessageRow;
  readonly files: FileRow[];
}

interface ConversationRow {
  readonly id: string;
}

interface ParentMessageRow {
  readonly id: string;
  readonly path: string | null;
  readonly child_count: number;
}

interface AppendPositionRequest {
  readonly parentMessage: ParentMessageRow | null;
  readonly appendPosition?: number;
}

interface AppendPositionResponse {
  readonly parentMessageId: string | null;
  readonly path: string;
}

interface DatabaseError {
  readonly code: string;
  readonly constraint?: string;
  readonly constraint_name?: string;
  readonly detail?: string;
}

export class PostgresAppendUserMessageStore implements AppendUserMessageStore {
  constructor(private readonly sql: PostgresDatabase) {}

  async persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<MessageWithFiles, ValidationError | StoreError>> {
    try {
      const row = await this.sql.begin(async (tx) => {
        const sql = tx as unknown as PostgresDatabase;
        const timestamp = new Date();
        await lockConversation(sql, input.message.conversationId);

        let allocation: AppendPositionResponse;

        if (input.parentMessageId === null) {
          const hasMessages = await conversationHasMessages(sql, input.message.conversationId);

          if (hasMessages) {
            throw new ValidationError("parentMessageId", "parentMessageId must be present when the conversation already has messages.");
          }

          allocation = calculateChildAttachPosition({
            parentMessage: null,
            appendPosition: input.appendPosition,
          });
        } else {
          const parentMessage = await lockParentMessage(sql, input.message.conversationId, input.parentMessageId);
          allocation = calculateChildAttachPosition({
            parentMessage,
            appendPosition: input.appendPosition,
          });
        }

        const messageRows = await sql<MessageRow[]>`
          insert into thoth.messages (
            conversation_id,
            parent_message_id,
            path,
            type,
            content,
            created_at,
            updated_at
          )
          values (
            ${input.message.conversationId},
            ${allocation.parentMessageId},
            ${allocation.path},
            ${input.message.type},
            ${input.message.content},
            ${input.message.createdAt.toISOString()},
            ${input.message.updatedAt.toISOString()}
          )
          returning
            id,
            conversation_id,
            parent_message_id,
            child_count,
            type,
            content,
            created_at,
            updated_at
        `;

        const messageRow = messageRows[0];

        if (!messageRow) {
          throw new Error("Message row was not returned.");
        }

        await incrementParentChildCount(sql, allocation.parentMessageId);

        const fileRows: FileRow[] = [];

        for (const file of input.files) {
          const insertedFileRows = await sql<FileRow[]>`
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
            returning
              id,
              message_id,
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
      if (error instanceof ValidationError) {
        return failure(error);
      }

      if (isUniquePathConstraintViolation(error)) {
        return failure(new ValidationError("appendPosition", "append position is already occupied."));
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

        await lockConversation(sql, firstMessage.conversationId);
        const parentMessage = await lockParentMessage(sql, firstMessage.conversationId, input.parentMessageId);
        const allocation = calculateChildAttachPosition({
          parentMessage,
          appendPosition: input.appendPosition,
        });
        let parentMessageId = allocation.parentMessageId;
        let path = allocation.path;

        for (const [index, message] of input.messages.entries()) {
          const rows = await sql<MessageRow[]>`
            insert into thoth.messages (
              conversation_id,
              parent_message_id,
              path,
              type,
              content,
              created_at,
              updated_at
            )
            values (
              ${message.conversationId},
              ${parentMessageId},
              ${path},
              ${message.type},
              ${message.content},
              ${message.createdAt.toISOString()},
              ${message.updatedAt.toISOString()}
            )
            returning
              id,
              conversation_id,
              parent_message_id,
              child_count,
              type,
              content,
              created_at,
              updated_at
          `;

          const messageRow = rows[0];

          if (!messageRow) {
            throw new Error("Message row was not returned.");
          }

          messageRows.push(messageRow);

          if (index === 0) {
            await incrementParentChildCount(sql, allocation.parentMessageId);
          } else {
            const previousRowIndex = index - 1;
            const previousRow = messageRows[previousRowIndex];

            if (!previousRow) {
              throw new Error("Previous completion message row was not returned.");
            }

            await incrementParentChildCount(sql, previousRow.id);
            messageRows[previousRowIndex] = {
              ...previousRow,
              child_count: 1,
            };
          }

          parentMessageId = messageRow.id;
          path = `${path}.1`;
        }

        return messageRows;
      });

      return mapMessageRows(rows);
    } catch (error) {
      if (error instanceof ValidationError) {
        return failure(error);
      }

      if (isUniquePathConstraintViolation(error)) {
        return failure(new ValidationError("appendPosition", "append position is already occupied."));
      }

      return failure(new StoreError(EntityType.Message, StoreOperation.Persist, getErrorMessage(error)));
    }
  }
}

function calculateChildAttachPosition(request: AppendPositionRequest): AppendPositionResponse {
  const appendPosition = request.appendPosition ?? getNextChildPosition(request.parentMessage);

  if (appendPosition === undefined) {
    throw new ValidationError("appendPosition", "appendPosition must be present.");
  }

  if (appendPosition <= 0) {
    throw new ValidationError("appendPosition", "appendPosition must be a positive integer.");
  }

  if (request.parentMessage === null) {
    return {
      parentMessageId: null,
      path: String(appendPosition),
    };
  }

  if (appendPosition !== request.parentMessage.child_count + 1) {
    throw new ValidationError("appendPosition", "appendPosition must be the next child position.");
  }

  return {
    parentMessageId: request.parentMessage.id,
    path: `${request.parentMessage.path}.${appendPosition}`,
  };
}

function getNextChildPosition(parentMessage: ParentMessageRow | null): number | undefined {
  return parentMessage === null ? undefined : parentMessage.child_count + 1;
}

async function lockParentMessage(sql: PostgresDatabase, conversationId: string, parentMessageId: string): Promise<ParentMessageRow> {
  const parentRows = await sql<ParentMessageRow[]>`
    select
      id,
      path,
      child_count
    from thoth.messages
    where conversation_id = ${conversationId}
      and id = ${parentMessageId}
    for no key update
  `;

  const parentMessage = parentRows[0];

  if (!parentMessage) {
    throw new ValidationError("parentMessageId", "parent message must belong to the conversation.");
  }

  if (parentMessage.path === null) {
    throw new ValidationError("parentMessageId", "parent message tree path has not been populated.");
  }

  return parentMessage;
}

async function incrementParentChildCount(sql: PostgresDatabase, parentMessageId: string | null): Promise<void> {
  if (parentMessageId === null) {
    return;
  }

  await sql`
    update thoth.messages
    set child_count = child_count + 1
    where id = ${parentMessageId}
  `;
}

async function lockConversation(sql: PostgresDatabase, conversationId: string): Promise<void> {
  const conversationRows = await sql<ConversationRow[]>`
    select id
    from thoth.conversations
    where id = ${conversationId}
    for no key update
  `;

  if (!conversationRows[0]) {
    throw new Error(`Conversation ${conversationId} was not found while appending a message.`);
  }
}

async function conversationHasMessages(sql: PostgresDatabase, conversationId: string): Promise<boolean> {
  const rows = await sql<{ has_messages: boolean }[]>`
    select exists (
      select 1
      from thoth.messages
      where conversation_id = ${conversationId}
    ) as has_messages
  `;

  const row = rows[0];

  if (!row) {
    throw new Error("Conversation message existence row was not returned.");
  }

  return row.has_messages;
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

function mapMessageWithFilesRow(row: MessageWithFilesRow): Result<MessageWithFiles, StoreError> {
  const messageResult = mapMessageRow(row.message);

  if (!messageResult.ok) {
    return messageResult;
  }

  const filesResult = mapFileRows(row.files);

  if (!filesResult.ok) {
    return filesResult;
  }

  return success({
    ...messageResult.value,
    files: filesResult.value,
  });
}

function mapMessageRow(row: MessageRow | undefined): Result<Message, StoreError> {
  if (!row) {
    return failure(new StoreError(EntityType.Message, StoreOperation.Persist, "Message row was not returned."));
  }

  try {
    return success(new Message(row.id, row.conversation_id, row.type, row.content, toDate(row.created_at), toDate(row.updated_at), row.parent_message_id, row.child_count));
  } catch (error) {
    if (error instanceof Error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.Persist, error.message));
    }

    return failure(new StoreError(EntityType.Message, StoreOperation.Persist, "Unexpected message mapping error."));
  }
}

function mapFileRows(rows: FileRow[]): Result<File[], StoreError> {
  const files: File[] = [];

  for (const row of rows) {
    const fileResult = mapFileRow(row);

    if (!fileResult.ok) {
      return fileResult;
    }

    files.push(fileResult.value);
  }

  return success(files);
}

function mapFileRow(row: FileRow | undefined): Result<File, StoreError> {
  if (!row) {
    return failure(new StoreError(EntityType.File, StoreOperation.Persist, "File row was not returned."));
  }

  try {
    return success(new File(row.id, row.message_id, row.canonical_url, row.filename, row.mime_type, row.size_in_bytes, toDate(row.created_at), toDate(row.updated_at)));
  } catch (error) {
    if (error instanceof Error) {
      return failure(new StoreError(EntityType.File, StoreOperation.Persist, error.message));
    }

    return failure(new StoreError(EntityType.File, StoreOperation.Persist, "Unexpected file mapping error."));
  }
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected database error.";
}

function isUniquePathConstraintViolation(error: unknown): boolean {
  if (!isDatabaseError(error) || error.code !== "23505") {
    return false;
  }

  const constraintName = getDatabaseErrorConstraintName(error);
  const message = getErrorMessage(error);
  const detail = typeof error.detail === "string" ? error.detail : "";

  return constraintName === "messages_path_unique" || message.includes("messages_path_unique") || detail.includes("(conversation_id, path)");
}

function getDatabaseErrorConstraintName(error: DatabaseError): string | undefined {
  return error.constraint ?? error.constraint_name;
}

function isDatabaseError(error: unknown): error is DatabaseError {
  return typeof error === "object" && error !== null && "code" in error;
}
