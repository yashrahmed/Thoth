import type { Conversation } from "../domain/objects/conversation";
import type { StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { firstFailure } from "../domain/objects/result";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import { requirePositiveInteger } from "../domain/validation";

export class ListConversationsFlow {
  constructor(private readonly conversationDomainService: ConversationDomainService) {}

  async execute(query: { readonly pageNum: number; readonly pageSize: number }): Promise<Result<Conversation[], StoreError | ValidationError>> {
    const validationResult = firstFailure(
      requirePositiveInteger(query.pageNum, "pageNum"),
      requirePositiveInteger(query.pageSize, "pageSize"),
    );

    if (!validationResult.ok) {
      return validationResult;
    }

    return this.conversationDomainService.findPage(query);
  }
}
