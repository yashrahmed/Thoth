import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface DeletedConversationGraph {
  readonly canonicalUrls: ReadonlyArray<string>;
}

export interface DeleteConversationGraphStore {
  deleteConversationGraph(conversationId: string): Promise<Result<DeletedConversationGraph, NotFoundError | StoreError>>;
}
