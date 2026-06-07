import type { Message } from "../objects/message-types";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface MessageRepository {
  selectMessageRow(messageId: string): Promise<Result<Message, NotFoundError | StoreError>>;
  selectMessageRowByIdAndConversationId(messageId: string, conversationId: string): Promise<Result<Message, NotFoundError | StoreError>>;
  selectLeafMessagesByConversation(conversationId: string): Promise<Result<Message[], StoreError>>;
  selectMessagePageForLeaf(request: {
    readonly conversationId: string;
    readonly leafMessageId: string;
    readonly pageNum: number;
    readonly pageSize: number;
  }): Promise<Result<Message[], StoreError>>;
  selectAllMessagesByConversation(conversationId: string): Promise<Result<Message[], StoreError>>;
  deleteMessageRow(messageId: string): Promise<Result<void, StoreError>>;
  deleteMessagesByConversation(conversationId: string): Promise<Result<void, StoreError>>;
}
