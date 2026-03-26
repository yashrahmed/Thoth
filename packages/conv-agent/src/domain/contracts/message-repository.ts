import type { Message } from "../objects/message";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface MessagePageRequest {
  readonly conversationId: string;
  readonly pageNum: number;
  readonly pageSize: number;
}

export interface MessageRepository {
  upsertMessageRow(record: Omit<Message, "id">): Promise<Result<Message, StoreError>>;
  selectMessageRow(messageId: string): Promise<Result<Message, NotFoundError | StoreError>>;
  selectMessagePage(request: MessagePageRequest): Promise<Result<Message[], StoreError>>;
  selectAllMessagesByConversation(conversationId: string): Promise<Result<Message[], StoreError>>;
  countMessagesByConversation(conversationId: string): Promise<Result<number, StoreError>>;
  deleteMessageRow(messageId: string): Promise<Result<void, StoreError>>;
  deleteMessagesByConversation(conversationId: string): Promise<Result<void, StoreError>>;
}
