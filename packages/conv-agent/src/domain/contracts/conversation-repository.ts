import type { Conversation } from "../objects/conversation";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface CreateConversationRecord {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ConversationPageRequest {
  readonly pageNum: number;
  readonly pageSize: number;
}

export interface ConversationOffsetPageRequest {
  readonly offset: number;
  readonly pageSize: number;
}

export interface ConversationRepository {
  upsertConversationRow(
    record: CreateConversationRecord,
  ): Promise<Result<Conversation, StoreError>>;
  selectConversationRow(
    conversationId: string,
  ): Promise<Result<Conversation, NotFoundError | StoreError>>;
  selectConversationPage(
    request: ConversationOffsetPageRequest,
  ): Promise<Result<Conversation[], StoreError>>;
  deleteConversationRow(
    conversationId: string,
  ): Promise<Result<void, StoreError>>;
}
