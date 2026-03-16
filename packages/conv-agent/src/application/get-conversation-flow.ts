import type { ConversationRepository } from "../domain/contracts/conversation-repository";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { requireNonEmptyString } from "./validators";

export interface GetConversationQuery {
  readonly conversationId: string;
}

export interface GetConversationResult {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class GetConversationFlow {
  constructor(private readonly repository: ConversationRepository) {}

  async execute(
    query: GetConversationQuery,
  ): Promise<
    Result<GetConversationResult, NotFoundError | StoreError | ValidationError>
  > {
    const conversationIdResult = requireNonEmptyString(
      query.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const result = await this.repository.getById(conversationIdResult.value);

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
