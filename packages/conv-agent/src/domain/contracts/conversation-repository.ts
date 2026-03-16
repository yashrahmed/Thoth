import type { Conversation } from "../objects/conversation";
import type { NotFoundError, StoreError, ValidationError } from "../objects/errors";
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
  getById(id: string): Promise<Result<Conversation, ValidationError | NotFoundError | StoreError>>;
  listPage(request: ConversationPageRequest): Promise<Result<Conversation[], ValidationError | StoreError>>;
  deleteById(id: string): Promise<Result<void, ValidationError | StoreError>>;
}
