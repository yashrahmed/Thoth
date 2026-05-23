import type { Conversation } from "../domain/objects/conversation";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { UpdateConversationRequest } from "../domain/objects/request-types";
import type { Result } from "../domain/objects/result";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";

export class UpdateConvFlow {
  constructor(private readonly conversationDomainService: ConversationDomainService) {}

  execute(request: UpdateConversationRequest): Promise<Result<Conversation, NotFoundError | StoreError | ValidationError>> {
    return this.conversationDomainService.renameConversation(request.conversationId, request.title);
  }
}
