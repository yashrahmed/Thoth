import type { MessageRepository } from "../contracts/message-repository";
import type { AppendMessageRecord, CreateMessageContentInput, Message } from "../objects/message-types";
import { EntityType, NotFoundError, ValidationError, type StoreError } from "../objects/errors";
import type { Result } from "../objects/result";
import { firstFailure } from "../objects/result";
import type { FileDomainService } from "./file-domain-service";
import { GenericValidationService } from "./generic-validation-service";
import type { MessageContentDomainService } from "./message-content-domain-service";

export class MessageDomainService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly messageContentDomainService: MessageContentDomainService,
    private readonly genericValidationService: GenericValidationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findById(messageId: string): Promise<Result<Message, ValidationError | NotFoundError | StoreError>> {
    const messageIdResult = this.genericValidationService.requireNonEmptyString(messageId, "messageId");

    if (!messageIdResult.ok) {
      return messageIdResult;
    }

    return this.messageRepository.selectMessageRow(messageIdResult.value);
  }

  findPage(request: { readonly conversationId: string; readonly pageNum: number; readonly pageSize: number }): Promise<Result<Message[], StoreError>> {
    return this.messageRepository.selectMessagePage(request);
  }

  // Returns the requested messages in the order the ids were given, so callers
  // control how the resulting chat is shaped.
  async findMessagesByIds(request: {
    readonly conversationId: string;
    readonly messageIds: ReadonlyArray<string>;
  }): Promise<Result<Message[], ValidationError | NotFoundError | StoreError>> {
    if (request.messageIds.length === 0) {
      return {
        ok: false,
        error: new ValidationError("messageIds", "messageIds must contain at least one message id."),
      };
    }

    const validationResult = firstFailure(
      this.genericValidationService.requireNonEmptyString(request.conversationId, "conversationId"),
      ...request.messageIds.map((messageId) => this.genericValidationService.requireNonEmptyString(messageId, "messageIds")),
    );

    if (!validationResult.ok) {
      return validationResult;
    }

    const messagesResult = await this.messageRepository.selectMessagesByIds(request);

    if (!messagesResult.ok) {
      return messagesResult;
    }

    const resolvedRequestedIds = new Set(messagesResult.value.map((resolved) => resolved.requestedId));

    for (const messageId of request.messageIds) {
      if (!resolvedRequestedIds.has(messageId)) {
        return { ok: false, error: new NotFoundError(EntityType.Message, messageId) };
      }
    }

    const canonicalIds = new Set<string>();

    for (const resolved of messagesResult.value) {
      if (canonicalIds.has(resolved.message.id)) {
        return {
          ok: false,
          error: new ValidationError("messageIds", "messageIds must not identify the same message more than once."),
        };
      }

      canonicalIds.add(resolved.message.id);
    }

    return { ok: true, value: messagesResult.value.map((resolved) => resolved.message) };
  }

  async delete(messageId: string): Promise<Result<void, ValidationError | StoreError>> {
    const messageIdResult = this.genericValidationService.requireNonEmptyString(messageId, "messageId");

    if (!messageIdResult.ok) {
      return messageIdResult;
    }

    return this.messageRepository.deleteMessageRow(messageIdResult.value);
  }

  async deleteAll(conversationId: string): Promise<Result<void, ValidationError | StoreError>> {
    const conversationIdResult = this.genericValidationService.requireNonEmptyString(conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    return this.messageRepository.deleteMessagesByConversation(conversationIdResult.value);
  }

  async deleteMessage(messageId: string): Promise<Result<void, ValidationError | NotFoundError | StoreError>> {
    const messageResult = await this.findById(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    return this.delete(messageId);
  }

  async deleteMessageWithFiles(messageId: string, fileDomainService: FileDomainService): Promise<Result<void, NotFoundError | StoreError | ValidationError>> {
    const messageResult = await this.findById(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    const deleteFilesResult = await fileDomainService.deleteFilesOnMessages({ messageIds: [messageResult.value.id] });

    if (!deleteFilesResult.ok) {
      return deleteFilesResult;
    }

    return this.delete(messageId);
  }

  buildNextMessageRecords(request: {
    readonly conversationId: string;
    readonly messages: ReadonlyArray<CreateMessageContentInput>;
  }): Result<AppendMessageRecord[], ValidationError> {
    if (request.messages.length === 0) {
      return {
        ok: false,
        error: new ValidationError("messages", "messages must contain at least one message."),
      };
    }

    const conversationIdResult = this.genericValidationService.requireNonEmptyString(request.conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    for (const message of request.messages) {
      const validationResult = this.messageContentDomainService.validateMessageInput({
        conversationId: request.conversationId,
        type: message.type,
        content: message.content,
      });

      if (!validationResult.ok) {
        return validationResult;
      }
    }

    const timestamp = this.now();
    const timestampValidationResult = firstFailure(
      this.genericValidationService.requireValidDate(timestamp, "createdAt"),
      this.genericValidationService.requireValidDate(timestamp, "updatedAt"),
    );

    if (!timestampValidationResult.ok) {
      return timestampValidationResult;
    }

    return {
      ok: true,
      value: request.messages.map((message) => ({
        conversationId: request.conversationId,
        type: message.type,
        content: message.content,
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    };
  }
}
