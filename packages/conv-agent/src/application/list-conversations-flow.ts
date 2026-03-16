import type { StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";

export interface ListConversationsQuery {
  readonly pageNum: number;
  readonly pageSize: number;
}

export interface ListConversationsItem {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class ListConversationsFlow {
  constructor(private readonly conversationDomainService: ConversationDomainService) {}

  async execute(
    query: ListConversationsQuery,
  ): Promise<Result<ListConversationsItem[], StoreError | ValidationError>> {
    const result = await this.conversationDomainService.listConversationsPage({
      pageNum: query.pageNum,
      pageSize: query.pageSize,
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: result.value.map((conversation) => ({
        id: conversation.id,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      })),
    };
  }
}
