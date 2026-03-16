import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { StoreError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";

export interface CreateConversationResult {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class CreateConversationFlow {
  constructor(private readonly conversationDomainService: ConversationDomainService) {}

  async execute(): Promise<Result<CreateConversationResult, StoreError>> {
    const result = await this.conversationDomainService.createConversation();

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
