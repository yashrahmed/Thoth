import type { DeleteConversationGraphStore, DeletedConversationGraph } from "../contracts/delete-conversation-graph-store";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export class DeleteConversationGraphDomainService {
  constructor(private readonly deleteConversationGraphStore: DeleteConversationGraphStore) {}

  async deleteConversationGraph(conversationId: string): Promise<Result<DeletedConversationGraph, NotFoundError | StoreError>> {
    return this.deleteConversationGraphStore.deleteConversationGraph(conversationId);
  }
}
