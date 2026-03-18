import type {
  CreateMessageRecord,
  MessageRepository,
  MessagePageRequest,
  MessageSequencePageRequest,
} from "../contracts/message-repository";
import type { Message, MessageType } from "../objects/message";
import {
  BlobStoreError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../objects/errors";
import type { Result } from "../objects/result";
import type { FileDomainService } from "./file-domain-service";
import type { ContentPart, ToolCall } from "../objects/message-content";
import { failure } from "../objects/result";
import {
  requireNonEmptyString,
  requirePositiveInteger,
  requirePresent,
} from "../validation";

export interface CreateMessageInput {
  readonly conversationId: string;
  readonly type: MessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<ContentPart>;
  readonly toolCalls: ReadonlyArray<ToolCall>;
  readonly toolCallId: string;
  readonly fileIds: ReadonlyArray<string>;
}

export interface CreateNextMessageInput {
  readonly conversationId: string;
  readonly type: MessageType;
  readonly content: ReadonlyArray<ContentPart>;
  readonly toolCalls: ReadonlyArray<ToolCall>;
  readonly toolCallId: string;
  readonly fileIds: ReadonlyArray<string>;
}

export class MessageDomainService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createMessage(
    request: CreateMessageInput,
  ): Promise<Result<Message, ValidationError | StoreError>> {
    return this.persistToMessageDBStore(
      this.buildRecord(request),
    );
  }

  async persistToMessageDBStore(
    record: CreateMessageRecord,
  ): Promise<Result<Message, ValidationError | StoreError>> {
    const conversationIdResult = requireNonEmptyString(
      record.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const sequenceNumberResult = requirePositiveInteger(
      record.sequenceNumber,
      "sequenceNumber",
    );

    if (!sequenceNumberResult.ok) {
      return sequenceNumberResult;
    }

    const typeResult = validateMessageType(record.type);

    if (!typeResult.ok) {
      return typeResult;
    }

    const contentResult = validateContent(record.content);

    if (!contentResult.ok) {
      return contentResult;
    }

    const toolCallsResult = validateToolCalls(record.toolCalls);

    if (!toolCallsResult.ok) {
      return toolCallsResult;
    }

    if (record.toolCallId.length > 0) {
      const toolCallIdResult = requireNonEmptyString(
        record.toolCallId,
        "toolCallId",
      );

      if (!toolCallIdResult.ok) {
        return toolCallIdResult;
      }
    }

    for (const fileId of record.fileIds) {
      const fileIdResult = requireNonEmptyString(fileId, "fileId");

      if (!fileIdResult.ok) {
        return fileIdResult;
      }
    }

    return this.messageRepository.upsertMessageRow(record);
  }

  async readFromMessageDBStore(
    messageId: string,
  ): Promise<Result<Message, ValidationError | NotFoundError | StoreError>> {
    const messageIdResult = requireNonEmptyString(
      messageId,
      "messageId",
    );

    if (!messageIdResult.ok) {
      return messageIdResult;
    }

    return this.messageRepository.selectMessageRow(messageIdResult.value);
  }

  async readPageFromMessageDBStore(
    request: MessagePageRequest,
  ): Promise<Result<Message[], ValidationError | StoreError>> {
    const conversationIdResult = requireNonEmptyString(
      request.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const pageNumResult = requirePositiveInteger(request.pageNum, "pageNum");

    if (!pageNumResult.ok) {
      return pageNumResult;
    }

    const pageSizeResult = requirePositiveInteger(request.pageSize, "pageSize");

    if (!pageSizeResult.ok) {
      return pageSizeResult;
    }

    const pageRequest: MessageSequencePageRequest = {
      conversationId: conversationIdResult.value,
      fromSequence: (pageNumResult.value - 1) * pageSizeResult.value + 1,
      pageSize: pageSizeResult.value,
    };

    return this.messageRepository.selectMessagePage(pageRequest);
  }

  async readAllMessagesFromMessageDBStore(
    conversationId: string,
  ): Promise<Result<Message[], ValidationError | StoreError>> {
    const conversationIdResult = requireNonEmptyString(
      conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    return this.messageRepository.selectAllMessagesByConversation(
      conversationIdResult.value,
    );
  }

  async readMessageCountFromMessageDBStore(
    conversationId: string,
  ): Promise<Result<number, ValidationError | StoreError>> {
    const conversationIdResult = requireNonEmptyString(
      conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    return this.messageRepository.countMessagesByConversation(
      conversationIdResult.value,
    );
  }

  async removeFromMessageDBStore(
    messageId: string,
  ): Promise<Result<void, ValidationError | StoreError>> {
    const messageIdResult = requireNonEmptyString(
      messageId,
      "messageId",
    );

    if (!messageIdResult.ok) {
      return messageIdResult;
    }

    return this.messageRepository.deleteMessageRow(messageIdResult.value);
  }
  async deleteMessage(
    messageId: string,
  ): Promise<Result<void, ValidationError | NotFoundError | StoreError>> {
    const messageResult = await this.readFromMessageDBStore(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    return this.removeFromMessageDBStore(messageId);
  }

  async deleteMessageWithFiles(
    messageId: string,
    fileDomainService: FileDomainService,
  ): Promise<Result<void, NotFoundError | StoreError | ValidationError | BlobStoreError>> {
    const messageResult = await this.readFromMessageDBStore(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    for (const fileId of messageResult.value.fileIds) {
      const deleteFileResult = await fileDomainService.deleteFile(fileId);

      if (!deleteFileResult.ok) {
        return deleteFileResult;
      }
    }

    return this.removeFromMessageDBStore(messageId);
  }
  async createNextMessage(
    request: CreateNextMessageInput,
  ): Promise<Result<Message, ValidationError | StoreError>> {
    const countResult = await this.readMessageCountFromMessageDBStore(
      request.conversationId,
    );

    if (!countResult.ok) {
      return countResult;
    }

    return this.createMessage({
      conversationId: request.conversationId,
      type: request.type,
      sequenceNumber: countResult.value + 1,
      content: request.content,
      toolCalls: request.toolCalls,
      toolCallId: request.toolCallId,
      fileIds: request.fileIds,
    });
  }

  private buildRecord(request: CreateMessageInput): CreateMessageRecord {
    const timestamp = this.now();

    return {
      conversationId: request.conversationId,
      type: request.type,
      sequenceNumber: request.sequenceNumber,
      content: request.content,
      toolCalls: request.toolCalls,
      toolCallId: request.toolCallId,
      fileIds: request.fileIds,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}

function validateMessageType(
  value: string,
): Result<MessageType, ValidationError> {
  const typeResult = requireNonEmptyString(value, "type");

  if (!typeResult.ok) {
    return typeResult;
  }

  if (
    value !== "user" &&
    value !== "assistant" &&
    value !== "system" &&
    value !== "tool"
  ) {
    return failure(
      new ValidationError(
        "type",
        "type must be one of user, assistant, system, or tool.",
      ),
    );
  }

  return {
    ok: true,
    value,
  };
}

function validateContent(
  content: ReadonlyArray<ContentPart>,
): Result<void, ValidationError> {
  const presentResult = requirePresent(content, "content");

  if (!presentResult.ok) {
    return presentResult;
  }

  if (!Array.isArray(content)) {
    return failure(new ValidationError("content", "content must be an array."));
  }

  for (const part of content) {
    if (part.type === "text") {
      const textResult = requireNonEmptyString(part.text, "content.text");

      if (!textResult.ok) {
        return textResult;
      }

      continue;
    }

    if (part.type === "image_url") {
      const imageUrlResult = requireNonEmptyString(
        part.imageUrl.url,
        "content.imageUrl.url",
      );

      if (!imageUrlResult.ok) {
        return imageUrlResult;
      }

      continue;
    }

    if (part.type === "file") {
      const fileIdResult = requireNonEmptyString(part.fileId, "content.fileId");

      if (!fileIdResult.ok) {
        return fileIdResult;
      }

      continue;
    }

    if (part.type === "audio") {
      const dataResult = requireNonEmptyString(part.data, "content.data");

      if (!dataResult.ok) {
        return dataResult;
      }

      continue;
    }

    return failure(
      new ValidationError(
        "content.type",
        "content.type must be text, image_url, file, or audio.",
      ),
    );
  }

  return { ok: true, value: undefined };
}

function validateToolCalls(
  toolCalls: ReadonlyArray<ToolCall>,
): Result<void, ValidationError> {
  const presentResult = requirePresent(toolCalls, "toolCalls");

  if (!presentResult.ok) {
    return presentResult;
  }

  if (!Array.isArray(toolCalls)) {
    return failure(
      new ValidationError("toolCalls", "toolCalls must be an array."),
    );
  }

  for (const toolCall of toolCalls) {
    const idResult = requireNonEmptyString(toolCall.id, "toolCall.id");

    if (!idResult.ok) {
      return idResult;
    }

    const nameResult = requireNonEmptyString(toolCall.name, "toolCall.name");

    if (!nameResult.ok) {
      return nameResult;
    }

    if (
      typeof toolCall.args !== "object" ||
      toolCall.args === null ||
      Array.isArray(toolCall.args)
    ) {
      return failure(
        new ValidationError("toolCall.args", "toolCall.args must be an object."),
      );
    }
  }

  return { ok: true, value: undefined };
}
