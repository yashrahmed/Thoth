import type { Conversation } from "../objects/conversation";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface ConversationRepository {
  upsertConversationRow(record: Omit<Conversation, "id">): Promise<Result<Conversation, StoreError>>;
  selectConversationRow(conversationId: string): Promise<Result<Conversation, NotFoundError | StoreError>>;
  selectConversationPage(request: { readonly pageNum: number; readonly pageSize: number }): Promise<Result<Conversation[], StoreError>>;
  deleteConversationRow(conversationId: string): Promise<Result<void, StoreError>>;
}
