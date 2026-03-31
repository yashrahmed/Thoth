import type { Conversation } from "../domain/objects/conversation";
import type { StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { firstFailure } from "../domain/objects/result";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import { GenericValidationService } from "../domain/services/generic-validation-service";

export class ListConversationsFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly genericValidationService: GenericValidationService,
  ) {}

  async execute(query: { readonly pageNum: number; readonly pageSize: number }): Promise<Result<Conversation[], StoreError | ValidationError>> {
    const validationResult = firstFailure(
      this.genericValidationService.requirePositiveInteger(query.pageNum, "pageNum"),
      this.genericValidationService.requirePositiveInteger(query.pageSize, "pageSize"),
    );

    if (!validationResult.ok) {
      return validationResult;
    }

    return this.conversationDomainService.findPage(query);
  }
}
