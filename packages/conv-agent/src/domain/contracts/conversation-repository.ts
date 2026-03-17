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

export interface ConversationRepository {
  persistToConversationDBStore(
    record: CreateConversationRecord,
  ): Promise<Result<Conversation, StoreError>>;
  readFromConversationDBStore(
    id: string,
  ): Promise<Result<Conversation, NotFoundError | StoreError>>;
  readPageFromConversationDBStore(
    request: ConversationPageRequest,
  ): Promise<Result<Conversation[], StoreError>>;
  removeFromConversationDBStore(
    id: string,
  ): Promise<Result<void, StoreError>>;
}
