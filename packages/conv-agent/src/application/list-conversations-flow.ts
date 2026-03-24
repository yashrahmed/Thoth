import type { StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { firstFailure, map } from "../domain/objects/result";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import { requirePositiveInteger } from "../domain/validation";

export class ListConversationsQuery {
  readonly pageNum: number;
  readonly pageSize: number;

  constructor(props: {
    readonly pageNum: number;
    readonly pageSize: number;
  }) {
    this.pageNum = props.pageNum;
    this.pageSize = props.pageSize;
  }

  isValid(): Result<void, ValidationError> {
    return firstFailure(requirePositiveInteger(this.pageNum, "pageNum"), requirePositiveInteger(this.pageSize, "pageSize"));
  }
}

export interface ListConversationsItem {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class ListConversationsFlow {
  constructor(private readonly conversationDomainService: ConversationDomainService) {}

  async execute(query: ListConversationsQuery): Promise<Result<ListConversationsItem[], StoreError | ValidationError>> {
    const validationResult = query.isValid();

    if (!validationResult.ok) {
      return validationResult;
    }

    return map(
      await this.conversationDomainService.readPageFromConversationDBStore({
        pageNum: query.pageNum,
        pageSize: query.pageSize,
      }),
      (conversations) =>
        conversations.map((conversation) => ({
          id: conversation.id,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        })),
    );
  }
}
