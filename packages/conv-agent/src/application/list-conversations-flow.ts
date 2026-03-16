import type { ConversationRepository } from "../domain/contracts/conversation-repository";
import type { Conversation } from "../domain/objects/conversation";
import type { StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { requirePositiveInteger } from "./validators";

export interface ListConversationsQuery {
  readonly pageNum: number;
  readonly pageSize: number;
}

export class ListConversationsFlow {
  constructor(private readonly repository: ConversationRepository) {}

  async execute(
    query: ListConversationsQuery,
  ): Promise<Result<Conversation[], StoreError | ValidationError>> {
    const pageNumResult = requirePositiveInteger(query.pageNum, "pageNum");

    if (!pageNumResult.ok) {
      return pageNumResult;
    }

    const pageSizeResult = requirePositiveInteger(query.pageSize, "pageSize");

    if (!pageSizeResult.ok) {
      return pageSizeResult;
    }

    return this.repository.listPage({
      offset: (pageNumResult.value - 1) * pageSizeResult.value,
      limit: pageSizeResult.value,
    });
  }
}
