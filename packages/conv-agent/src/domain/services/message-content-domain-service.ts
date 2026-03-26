import { requireNonEmptyString, requirePositiveInteger, requirePresent } from "../validation";
import { ValidationError } from "../objects/errors";
import { LLM_MESSAGE_TYPES, type LLMMessageType } from "../objects/llm";
import type { CreateMessageInput, Message } from "../objects/message";
import { failure, success, type Result } from "../objects/result";

export class MessageContentDomainService {
  validateMessageInput(request: CreateMessageInput): Result<void, ValidationError> {
    return this.validateMessageInputLike(request.conversationId, request.type, request.content, request.fileIds);
  }

  validateMessageRecord(record: Omit<Message, "id">): Result<void, ValidationError> {
    return this.validateMessageInputLike(record.conversationId, record.type, record.content, record.fileIds, record.sequenceNumber);
  }

  private validateMessageInputLike(
    conversationId: string,
    type: LLMMessageType,
    content: string,
    fileIds: ReadonlyArray<string>,
    sequenceNumber?: number,
  ): Result<void, ValidationError> {
    const conversationIdResult = requireNonEmptyString(conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    if (sequenceNumber !== undefined) {
      const sequenceNumberResult = requirePositiveInteger(sequenceNumber, "sequenceNumber");

      if (!sequenceNumberResult.ok) {
        return sequenceNumberResult;
      }
    }

    if (!LLM_MESSAGE_TYPES.includes(type)) {
      return failure(new ValidationError("type", "type must be one of user, assistant, system, or tool."));
    }

    const contentResult = requirePresent(content, "content");

    if (!contentResult.ok) {
      return contentResult;
    }

    if (typeof content !== "string") {
      return failure(new ValidationError("content", "content must be a string."));
    }

    if (!Array.isArray(fileIds)) {
      return failure(new ValidationError("fileIds", "fileIds must be an array."));
    }

    for (const fileId of fileIds) {
      const fileIdResult = requireNonEmptyString(fileId, "fileIds");

      if (!fileIdResult.ok) {
        return fileIdResult;
      }
    }

    if (content.trim().length === 0 && fileIds.length === 0) {
      return failure(new ValidationError("content", "content must be a non-empty string when no files are attached."));
    }

    return success(undefined);
  }
}
