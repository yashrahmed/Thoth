import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { Conversation } from "../domain/objects/conversation";
import type { StoreError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";

export class CreateConversationFlow {
  constructor(private readonly conversationDomainService: ConversationDomainService) {}

  execute(): Promise<Result<Conversation, StoreError>> {
    return this.conversationDomainService.createConversation();
  }
}
