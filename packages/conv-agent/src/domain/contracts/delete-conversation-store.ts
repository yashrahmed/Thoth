import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface DeletedConversation {
  readonly canonicalUrls: ReadonlyArray<string>;
}

export interface DeleteConversationStore {
  deleteConversation(conversationId: string): Promise<Result<DeletedConversation, NotFoundError | StoreError>>;
}
