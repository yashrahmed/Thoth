import { Conversation } from "../../domain/objects/conversation";
import { EntityType, StoreError, StoreOperation } from "../../domain/objects/errors";
import type { LLMMessageType } from "../../domain/objects/llm";
import { File, Message } from "../../domain/objects/message-types";
import { failure, type Result, success } from "../../domain/objects/result";

export interface ConversationRow {
  readonly id: string;
  readonly title: string | null;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export interface MessageRow {
  readonly id: string;
  readonly conversation_id: string;
  readonly parent_message_id: string | null;
  readonly child_count: number;
  readonly type: LLMMessageType;
  readonly content: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export interface FileRow {
  readonly id: string;
  readonly message_id: string;
  readonly canonical_url: string;
  readonly filename: string;
  readonly mime_type: string;
  readonly size_in_bytes: number;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

export function mapConversationRows(rows: ReadonlyArray<ConversationRow>, operation: StoreOperation): Result<Conversation[], StoreError> {
  return mapRows(rows, (row) => mapConversationRow(row, operation));
}

export function mapConversationRow(row: ConversationRow | undefined, operation: StoreOperation): Result<Conversation, StoreError> {
  if (!row) {
    return failure(new StoreError(EntityType.Conversation, operation, "Conversation row was not returned."));
  }

  try {
    return success(new Conversation(row.id, row.title, toDate(row.created_at), toDate(row.updated_at)));
  } catch (error) {
    if (error instanceof Error) {
      return failure(new StoreError(EntityType.Conversation, operation, error.message));
    }

    return failure(new StoreError(EntityType.Conversation, operation, "Unexpected conversation mapping error."));
  }
}

export function mapMessageRows(rows: ReadonlyArray<MessageRow>, operation: StoreOperation): Result<Message[], StoreError> {
  return mapRows(rows, (row) => mapMessageRow(row, operation));
}

export function mapMessageRow(row: MessageRow | undefined, operation: StoreOperation): Result<Message, StoreError> {
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

export function mapFileRows(rows: ReadonlyArray<FileRow>, operation: StoreOperation): Result<File[], StoreError> {
  return mapRows(rows, (row) => mapFileRow(row, operation));
}

export function mapFileRow(row: FileRow | undefined, operation: StoreOperation): Result<File, StoreError> {
  if (!row) {
    return failure(new StoreError(EntityType.File, operation, "File row was not returned."));
  }

  try {
    return success(new File(row.id, row.message_id, row.canonical_url, row.filename, row.mime_type, row.size_in_bytes, toDate(row.created_at), toDate(row.updated_at)));
  } catch (error) {
    if (error instanceof Error) {
      return failure(new StoreError(EntityType.File, operation, error.message));
    }

    return failure(new StoreError(EntityType.File, operation, "Unexpected file mapping error."));
  }
}

export function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function mapRows<Row, Entity>(rows: ReadonlyArray<Row>, mapRow: (row: Row) => Result<Entity, StoreError>): Result<Entity[], StoreError> {
  const entities: Entity[] = [];

  for (const row of rows) {
    const result = mapRow(row);

    if (!result.ok) {
      return result;
    }

    entities.push(result.value);
  }

  return success(entities);
}
