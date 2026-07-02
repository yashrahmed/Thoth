import type { Message } from "../objects/message-types";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface MessageRepository {
  selectMessageRow(messageId: string): Promise<Result<Message, NotFoundError | StoreError>>;
  selectMessageRowByIdAndConversationId(messageId: string, conversationId: string): Promise<Result<Message, NotFoundError | StoreError>>;
  selectMessagePage(request: { readonly conversationId: string; readonly pageNum: number; readonly pageSize: number }): Promise<Result<Message[], StoreError>>;
  selectMessagesUpTo(request: { readonly conversationId: string; readonly messageId: string }): Promise<Result<Message[], NotFoundError | StoreError>>;
  deleteMessageRow(messageId: string): Promise<Result<void, StoreError>>;
  deleteMessagesByConversation(conversationId: string): Promise<Result<void, StoreError>>;
}
