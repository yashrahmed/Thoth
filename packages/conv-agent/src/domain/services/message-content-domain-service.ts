import { ValidationError } from "../objects/errors";
import { LLM_MESSAGE_TYPES, type LLMMessageType } from "../objects/llm";
import type { CreateMessageInput, Message } from "../objects/message-types";
import { failure, success, type Result } from "../objects/result";
import { GenericValidationService } from "./generic-validation-service";

export class MessageContentDomainService {
  constructor(private readonly genericValidationService: GenericValidationService) {}

  validateMessageInput(request: CreateMessageInput): Result<void, ValidationError> {
    return this.validateMessageInputLike(request.conversationId, request.type, request.content);
  }

  validateMessageRecord(record: Omit<Message, "id">): Result<void, ValidationError> {
    return this.validateMessageInputLike(record.conversationId, record.type, record.content);
  }

  private validateMessageInputLike(conversationId: string, type: LLMMessageType, content: string): Result<void, ValidationError> {
    const conversationIdResult = this.genericValidationService.requireNonEmptyString(conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    if (!LLM_MESSAGE_TYPES.includes(type)) {
      return failure(new ValidationError("type", "type must be one of user, assistant, system, or tool."));
    }

    const contentResult = this.genericValidationService.requirePresent(content, "content");

    if (!contentResult.ok) {
      return contentResult;
    }

    if (typeof content !== "string") {
      return failure(new ValidationError("content", "content must be a string."));
    }

    return success(undefined);
  }
}
