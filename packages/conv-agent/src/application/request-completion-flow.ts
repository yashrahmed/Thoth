import type { LLMCompletionRunService } from "../domain/contracts/llm-completion-run-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { GenericValidationService } from "../domain/services/generic-validation-service";
import type { MessageDomainService } from "../domain/services/message-domain-service";
import { LLMMessageType } from "../domain/objects/llm";
import { ValidationError, type NotFoundError, type StoreError } from "../domain/objects/errors";
import { failure, firstFailure, success, type Result } from "../domain/objects/result";

interface RequestCompletionRequest {
  readonly conversationId: string;
  readonly parentMessageId: string;
  readonly appendPosition: number;
}

/**
 * Validates a completion request and schedules the LLM run. The caller names
 * the parent message and the child slot the reply must occupy, which makes
 * retries idempotent: a duplicate request targets an occupied position and the
 * run is dropped by the append store. The flow returns once the run is
 * scheduled; the reply lands asynchronously.
 */
export class RequestCompletionFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly genericValidationService: GenericValidationService,
    private readonly llmCompletionRunService: LLMCompletionRunService,
  ) {}

  async execute(request: RequestCompletionRequest): Promise<Result<void, ValidationError | NotFoundError | StoreError>> {
    const validationResult = firstFailure(
      this.genericValidationService.requireNonEmptyString(request.conversationId, "conversationId"),
      this.genericValidationService.requireNonEmptyString(request.parentMessageId, "parentMessageId"),
      this.genericValidationService.requirePositiveInteger(request.appendPosition, "appendPosition"),
    );

    if (!validationResult.ok) {
      return validationResult;
    }

    const conversationResult = await this.conversationDomainService.findById(request.conversationId);

    if (!conversationResult.ok) {
      return conversationResult;
    }

    const parentMessageResult = await this.messageDomainService.findByIdInConversation(request.parentMessageId, request.conversationId);

    if (!parentMessageResult.ok) {
      return parentMessageResult;
    }

    if (parentMessageResult.value.type !== LLMMessageType.User) {
      return failure(new ValidationError("parentMessageId", `parentMessageId must reference a user message; received ${parentMessageResult.value.type}.`));
    }

    this.llmCompletionRunService.run({
      conversationId: request.conversationId,
      parentMessageId: request.parentMessageId,
      appendPosition: request.appendPosition,
    });

    return success(undefined);
  }
}
