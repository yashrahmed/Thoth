import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";

export interface GetConversationQuery {
  readonly conversationId: string;
}

export interface GetConversationResult {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class GetConversationFlow {
  constructor(private readonly conversationDomainService: ConversationDomainService) {}

  async execute(
    query: GetConversationQuery,
  ): Promise<
    Result<GetConversationResult, NotFoundError | StoreError | ValidationError>
  > {
    const result = await this.conversationDomainService.readFromConversationDBStore(
      query.conversationId,
    );

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        id: result.value.id,
        createdAt: result.value.createdAt,
        updatedAt: result.value.updatedAt,
      },
    };
  }
}
