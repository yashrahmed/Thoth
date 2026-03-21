import { requireNonEmptyString, requirePresent } from "../validation";
import { ValidationError } from "./errors";
import { failure, success, type Result } from "./result";

export interface TextPart {
  readonly type: "text";
  readonly text: string;
}

export interface ImagePart {
  readonly type: "image";
  readonly fileId: string;
  readonly mediaType?: string;
}

export interface FilePart {
  readonly type: "file";
  readonly fileId: string;
  readonly mediaType?: string;
  readonly filename?: string;
}

export interface AudioPart {
  readonly type: "audio";
  readonly fileId: string;
  readonly mediaType?: string;
}

export interface ToolCallPart {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

export interface ToolResultPart {
  readonly type: "tool-result";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: unknown;
}

export type BlobPart = ImagePart | FilePart | AudioPart;
export type PromptPart = TextPart | BlobPart;
export type MessagePart = TextPart | ImagePart | FilePart | AudioPart | ToolCallPart | ToolResultPart;

export function isBlobPart(part: MessagePart): part is BlobPart {
  return part.type === "image" || part.type === "file" || part.type === "audio";
}

export function collectBlobPartFileIds(parts: ReadonlyArray<MessagePart>): ReadonlyArray<string> {
  const fileIds = new Set<string>();

  for (const part of parts) {
    if (isBlobPart(part)) {
      fileIds.add(part.fileId);
    }
  }

  return [...fileIds];
}

export function replaceBlobPartFileIds(parts: ReadonlyArray<MessagePart>, fileIds: ReadonlyArray<string>): Result<ReadonlyArray<MessagePart>, ValidationError> {
  const replacedParts: MessagePart[] = [];
  let fileIndex = 0;

  for (const part of parts) {
    if (!isBlobPart(part)) {
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

export function validateMessageParts(type: string, content: ReadonlyArray<MessagePart>): Result<void, ValidationError> {
  const contentResult = requirePresent(content, "content");

  if (!contentResult.ok) {
    return contentResult;
  }

  if (!Array.isArray(content)) {
    return failure(new ValidationError("content", "content must be an array."));
  }

  for (const part of content) {
    const partValidationResult = validateMessagePart(part);

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

function validateMessagePart(part: MessagePart): Result<void, ValidationError> {
  if (part.type === "text") {
    const textResult = requireNonEmptyString(part.text, "content.text");

    if (!textResult.ok) {
      return textResult;
    }

    return success(undefined);
  }

  if (part.type === "image" || part.type === "file" || part.type === "audio") {
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

      return success(undefined);
    }

    return success(undefined);
  }

  if (part.type === "tool-call") {
    const toolCallIdResult = requireNonEmptyString(part.toolCallId, "content.toolCallId");

    if (!toolCallIdResult.ok) {
      return toolCallIdResult;
    }

    const toolNameResult = requireNonEmptyString(part.toolName, "content.toolName");

    if (!toolNameResult.ok) {
      return toolNameResult;
    }

    if (typeof part.input !== "object" || part.input === null || Array.isArray(part.input)) {
      return failure(new ValidationError("content.input", "content.input must be an object."));
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

  return success(undefined);
}
