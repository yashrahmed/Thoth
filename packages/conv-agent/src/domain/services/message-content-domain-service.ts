import { requireNonEmptyString, requirePositiveInteger, requirePresent } from "../validation";
import { ValidationError } from "../objects/errors";
import { LLM_MESSAGE_TYPES, type LLMMessageType } from "../objects/llm";
import { type BlobPart, type MessagePart } from "../objects/message";
import { CreateNextMessageInput } from "../objects/message-input";
import { CreateMessageRecord } from "../contracts/message-repository";
import { failure, success, type Result } from "../objects/result";

export class MessageContentDomainService {
  validateMessageInput(request: CreateNextMessageInput): Result<void, ValidationError> {
    return this.validateMessageInputLike(request.conversationId, request.type, request.content);
  }

  validateMessageRecord(record: CreateMessageRecord): Result<void, ValidationError> {
    return this.validateMessageInputLike(record.conversationId, record.type, record.content, record.sequenceNumber);
  }

  isBlobPart(part: MessagePart): part is BlobPart {
    return part.type === "image" || part.type === "file" || part.type === "audio";
  }

  collectBlobPartFileIds(parts: ReadonlyArray<MessagePart>): ReadonlyArray<string> {
    const fileIds = new Set<string>();

    for (const part of parts) {
      if (this.isBlobPart(part)) {
        fileIds.add(part.fileId);
      }
    }

    return [...fileIds];
  }

  replaceBlobPartFileIds(parts: ReadonlyArray<MessagePart>, fileIds: ReadonlyArray<string>): Result<ReadonlyArray<MessagePart>, ValidationError> {
    const replacedParts: MessagePart[] = [];
    let fileIndex = 0;

    for (const part of parts) {
      if (!this.isBlobPart(part)) {
        replacedParts.push(part);
        continue;
      }

      const fileId = fileIds[fileIndex];

      if (!fileId) {
        return failure(new ValidationError("attachments", "attachments must match blob parts in content by order."));
      }

      replacedParts.push({
        ...part,
        fileId,
      });
      fileIndex += 1;
    }

    if (fileIndex !== fileIds.length) {
      return failure(new ValidationError("attachments", "attachments must match blob parts in content by order."));
    }

    return success(replacedParts);
  }

  private validateMessageInputLike(
    conversationId: string,
    type: LLMMessageType,
    content: ReadonlyArray<MessagePart>,
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

    if (!Array.isArray(content)) {
      return failure(new ValidationError("content", "content must be an array."));
    }

    for (const part of content) {
      const partValidationResult = this.validateMessagePart(part);

      if (!partValidationResult.ok) {
        return partValidationResult;
      }

      if ((type === "system" || type === "user") && (part.type === "tool-call" || part.type === "tool-result")) {
        return failure(new ValidationError("content.type", `${type} messages must contain only text, image, file, or audio parts.`));
      }

      if (type === "assistant" && part.type !== "text" && part.type !== "tool-call") {
        return failure(new ValidationError("content.type", "assistant messages must contain only text or tool-call parts."));
      }

      if (type === "tool" && part.type !== "tool-result") {
        return failure(new ValidationError("content.type", "tool messages must contain only tool-result parts."));
      }
    }

    return success(undefined);
  }

  private validateMessagePart(part: MessagePart): Result<void, ValidationError> {
    if (part.type === "text") {
      const textResult = requireNonEmptyString(part.text, "content.text");

      if (!textResult.ok) {
        return textResult;
      }

      return success(undefined);
    }

    if (this.isBlobPart(part)) {
      const fileIdResult = requireNonEmptyString(part.fileId, "content.fileId");

      if (!fileIdResult.ok) {
        return fileIdResult;
      }

      if (part.mediaType !== undefined) {
        const mediaTypeResult = requireNonEmptyString(part.mediaType, "content.mediaType");

        if (!mediaTypeResult.ok) {
          return mediaTypeResult;
        }
      }

      if (part.type === "file" && part.filename !== undefined) {
        const filenameResult = requireNonEmptyString(part.filename, "content.filename");

        if (!filenameResult.ok) {
          return filenameResult;
        }
      }

      return success(undefined);
    }

    const toolCallIdResult = requireNonEmptyString(part.toolCallId, "content.toolCallId");

    if (!toolCallIdResult.ok) {
      return toolCallIdResult;
    }

    const toolNameResult = requireNonEmptyString(part.toolName, "content.toolName");

    if (!toolNameResult.ok) {
      return toolNameResult;
    }

    if (part.type === "tool-call" && (typeof part.input !== "object" || part.input === null || Array.isArray(part.input))) {
      return failure(new ValidationError("content.input", "content.input must be an object."));
    }

    return success(undefined);
  }
}
