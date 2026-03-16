import type { ConversationRepository } from "../domain/contracts/conversation-repository";
import type { Conversation } from "../domain/objects/conversation";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { requireNonEmptyString } from "./validators";

export interface GetConversationQuery {
  readonly conversationId: string;
}

export class GetConversationFlow {
  constructor(private readonly repository: ConversationRepository) {}

  async execute(
    query: GetConversationQuery,
  ): Promise<Result<Conversation, NotFoundError | StoreError | ValidationError>> {
    const conversationIdResult = requireNonEmptyString(
      query.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    return this.repository.getById(conversationIdResult.value);
  }
}
