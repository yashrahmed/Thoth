import type { Message } from "../objects/message";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface CreateMessageRecord {
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly fileIds: ReadonlyArray<string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MessagePageRequest {
  readonly conversationId: string;
  readonly pageNum: number;
  readonly pageSize: number;
}

export interface MessageSequencePageRequest {
  readonly conversationId: string;
  readonly fromSequence: number;
  readonly pageSize: number;
}

export interface MessageRepository {
  persistToMessageDBStore(
    record: CreateMessageRecord,
  ): Promise<Result<Message, StoreError>>;
  readFromMessageDBStore(
    messageId: string,
  ): Promise<Result<Message, NotFoundError | StoreError>>;
  readPageFromMessageDBStore(
    request: MessageSequencePageRequest,
  ): Promise<Result<Message[], StoreError>>;
  readAllMessagesFromMessageDBStore(
    conversationId: string,
  ): Promise<Result<Message[], StoreError>>;
  readMessageCountFromMessageDBStore(
    conversationId: string,
  ): Promise<Result<number, StoreError>>;
  removeFromMessageDBStore(messageId: string): Promise<Result<void, StoreError>>;
}
