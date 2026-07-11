import type { Message } from "../objects/message-types";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface ResolvedMessage {
  readonly requestedId: string;
  readonly message: Message;
}

export interface MessageRepository {
  selectMessageRow(messageId: string): Promise<Result<Message, NotFoundError | StoreError>>;
  selectMessagePage(request: { readonly conversationId: string; readonly pageNum: number; readonly pageSize: number }): Promise<Result<Message[], StoreError>>;
  /** Resolves every input ID and returns results in the caller's input order. */
  selectMessagesByIds(request: { readonly conversationId: string; readonly messageIds: ReadonlyArray<string> }): Promise<Result<ResolvedMessage[], StoreError>>;
  deleteMessageRow(messageId: string): Promise<Result<void, StoreError>>;
  deleteMessagesByConversation(conversationId: string): Promise<Result<void, StoreError>>;
}
