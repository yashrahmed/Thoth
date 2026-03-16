import type { Conversation } from "../objects/conversation";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface CreateConversationRecord {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ConversationPageRequest {
  readonly offset: number;
  readonly limit: number;
}

export interface ConversationRepository {
  create(
    record: CreateConversationRecord,
  ): Promise<Result<Conversation, StoreError>>;
  getById(id: string): Promise<Result<Conversation, NotFoundError | StoreError>>;
  listPage(
    request: ConversationPageRequest,
  ): Promise<Result<Conversation[], StoreError>>;
  deleteById(id: string): Promise<Result<void, StoreError>>;
}
