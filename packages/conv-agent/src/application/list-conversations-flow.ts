import type { StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { firstFailure, map } from "../domain/objects/result";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import { requirePositiveInteger } from "../domain/validation";
import type { ConversationPageRequest } from "../domain/contracts/conversation-repository";

export interface ListConversationsItem {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class ListConversationsFlow {
  constructor(private readonly conversationDomainService: ConversationDomainService) {}

  async execute(query: ConversationPageRequest): Promise<Result<ListConversationsItem[], StoreError | ValidationError>> {
    const validationResult = firstFailure(
      requirePositiveInteger(query.pageNum, "pageNum"),
      requirePositiveInteger(query.pageSize, "pageSize"),
    );

    if (!validationResult.ok) {
      return validationResult;
    }

    return map(
      await this.conversationDomainService.findPage(query),
      (conversations) =>
        conversations.map((conversation) => ({
          id: conversation.id,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        })),
    );
  }
}
