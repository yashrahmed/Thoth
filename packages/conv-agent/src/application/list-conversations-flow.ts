import type { ConversationRepository } from "../domain/contracts/conversation-repository";
import type { StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";

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
  constructor(private readonly repository: ConversationRepository) {}

  async execute(
    query: ListConversationsQuery,
  ): Promise<Result<ListConversationsItem[], StoreError | ValidationError>> {
    const result = await this.repository.listPage({
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
