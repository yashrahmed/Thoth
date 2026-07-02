import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { GenericValidationService } from "../domain/services/generic-validation-service";
import type { LlmCompletionDomainService } from "../domain/services/llm-completion-domain-service";
import type { MessageDomainService } from "../domain/services/message-domain-service";
import { LLMMessageType, type LlmCompletionMessage } from "../domain/objects/llm";
import { ValidationError, type LlmError, type NotFoundError, type StoreError } from "../domain/objects/errors";
import { failure, firstFailure, type Result } from "../domain/objects/result";

interface RequestCompletionRequest {
  readonly conversationId: string;
  readonly messageId: string;
}

/**
 * Validates a completion request, runs the LLM over the conversation history
 * up to and including the target message, and returns the completion messages
 * to the caller. Nothing is persisted: the caller decides whether to add the
 * completion to the conversation by appending it explicitly.
 */
export class RequestCompletionFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly genericValidationService: GenericValidationService,
    private readonly llmCompletionDomainService: LlmCompletionDomainService,
  ) {}

  async execute(request: RequestCompletionRequest): Promise<Result<LlmCompletionMessage[], ValidationError | NotFoundError | StoreError | LlmError>> {
    const validationResult = firstFailure(
      this.genericValidationService.requireNonEmptyString(request.conversationId, "conversationId"),
      this.genericValidationService.requireNonEmptyString(request.messageId, "messageId"),
    );

    if (!validationResult.ok) {
      return validationResult;
    }

    const conversationResult = await this.conversationDomainService.findById(request.conversationId);

    if (!conversationResult.ok) {
      return conversationResult;
    }

    const messageResult = await this.messageDomainService.findByIdInConversation(request.messageId, request.conversationId);

    if (!messageResult.ok) {
      return messageResult;
    }

    if (messageResult.value.type !== LLMMessageType.User) {
      return failure(new ValidationError("messageId", `messageId must reference a user message; received ${messageResult.value.type}.`));
    }

    return this.llmCompletionDomainService.complete({
      conversationId: request.conversationId,
      messageId: request.messageId,
    });
  }
}
