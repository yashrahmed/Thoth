import type { DeleteConversationStore, DeletedConversation } from "../contracts/delete-conversation-store";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export class DeleteConversationDomainService {
  constructor(private readonly deleteConversationStore: DeleteConversationStore) {}

  deleteConversation(conversationId: string): Promise<Result<DeletedConversation, NotFoundError | StoreError>> {
    return this.deleteConversationStore.deleteConversation(conversationId);
  }
}
