import type { Conversation } from "../domain/objects/conversation";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { GetConversationRequest } from "../domain/objects/request-types";

export class GetConversationFlow {
  constructor(private readonly conversationDomainService: ConversationDomainService) {}

  execute(request: GetConversationRequest): Promise<Result<Conversation, NotFoundError | StoreError | ValidationError>> {
    return this.conversationDomainService.findById(request.conversationId);
  }
}
