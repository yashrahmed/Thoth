import type { Message } from "../objects/message";
import type { NotFoundError, StoreError, ValidationError } from "../objects/errors";
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

export interface MessageRepository {
  create(record: CreateMessageRecord): Promise<Result<Message, ValidationError | StoreError>>;
  getById(id: string): Promise<Result<Message, NotFoundError | StoreError>>;
  listPageByConversation(request: MessagePageRequest): Promise<Result<Message[], ValidationError | StoreError>>;
  listByConversation(conversationId: string): Promise<Result<Message[], ValidationError | StoreError>>;
  countByConversation(conversationId: string): Promise<Result<number, ValidationError | StoreError>>;
  deleteById(id: string): Promise<Result<void, StoreError>>;
}
