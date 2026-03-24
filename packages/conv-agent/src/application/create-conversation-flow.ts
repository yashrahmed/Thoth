import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { StoreError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { map } from "../domain/objects/result";

export interface CreateConversationResult {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class CreateConversationFlow {
  constructor(private readonly conversationDomainService: ConversationDomainService) {}

  async execute(): Promise<Result<CreateConversationResult, StoreError>> {
    return map(await this.conversationDomainService.createConversation(), (conv) => ({
      id: conv.id,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }));
  }
}
