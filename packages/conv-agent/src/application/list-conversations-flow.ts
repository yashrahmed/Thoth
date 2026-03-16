import type { ConversationRepository } from "../domain/contracts/conversation-repository";
import type { StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { requirePositiveInteger } from "./validators";

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
    const pageNumResult = requirePositiveInteger(query.pageNum, "pageNum");

    if (!pageNumResult.ok) {
      return pageNumResult;
    }

    const pageSizeResult = requirePositiveInteger(query.pageSize, "pageSize");

    if (!pageSizeResult.ok) {
      return pageSizeResult;
    }

    const result = await this.repository.listPage({
      offset: (pageNumResult.value - 1) * pageSizeResult.value,
      limit: pageSizeResult.value,
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
