import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { GenericValidationService } from "../domain/services/generic-validation-service";
import type { LlmCompletionDomainService } from "../domain/services/llm-completion-domain-service";
import type { LlmCompletionMessage } from "../domain/objects/llm";
import { ValidationError, type LlmError, type NotFoundError, type StoreError } from "../domain/objects/errors";
import { failure, type Result } from "../domain/objects/result";

interface RequestCompletionRequest {
  readonly conversationId: string;
  readonly messageIds: ReadonlyArray<string>;
}

/**
 * Validates a completion request, runs the LLM over exactly the requested
 * messages (in the order their ids were given), and returns the completion
 * messages to the caller. Nothing is persisted: the caller decides whether to
 * add the completion to the conversation by appending it explicitly.
 */
export class RequestCompletionFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly genericValidationService: GenericValidationService,
    private readonly llmCompletionDomainService: LlmCompletionDomainService,
  ) {}

  async execute(request: RequestCompletionRequest): Promise<Result<LlmCompletionMessage[], ValidationError | NotFoundError | StoreError | LlmError>> {
    const validationResult = this.genericValidationService.requireNonEmptyString(request.conversationId, "conversationId");

    if (!validationResult.ok) {
      return validationResult;
    }

    if (request.messageIds.length === 0) {
      return failure(new ValidationError("messageIds", "messageIds must contain at least one message id."));
    }

    const conversationResult = await this.conversationDomainService.findById(request.conversationId);

    if (!conversationResult.ok) {
      return conversationResult;
    }

    return this.llmCompletionDomainService.complete({
      conversationId: request.conversationId,
      messageIds: request.messageIds,
    });
  }
}
