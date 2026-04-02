import type { MessageRepository } from "../contracts/message-repository";
import type { CreateMessageInput, InsertNextMessageRecord, Message } from "../objects/message";
import { NotFoundError, ValidationError, type StoreError } from "../objects/errors";
import type { Result } from "../objects/result";
import { andThenAsync, firstFailure } from "../objects/result";
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
    return andThenAsync(this.genericValidationService.requireNonEmptyString(messageId, "messageId"), (id) => this.messageRepository.selectMessageRow(id));
  }

  async findPage(request: { readonly conversationId: string; readonly pageNum: number; readonly pageSize: number }): Promise<Result<Message[], StoreError>> {
    return this.messageRepository.selectMessagePage(request);
  }

  async findAll(conversationId: string): Promise<Result<Message[], ValidationError | StoreError>> {
    return andThenAsync(this.genericValidationService.requireNonEmptyString(conversationId, "conversationId"), (id) => this.messageRepository.selectAllMessagesByConversation(id));
  }

  async delete(messageId: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(this.genericValidationService.requireNonEmptyString(messageId, "messageId"), (id) => this.messageRepository.deleteMessageRow(id));
  }

  async deleteAll(conversationId: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(this.genericValidationService.requireNonEmptyString(conversationId, "conversationId"), (id) => this.messageRepository.deleteMessagesByConversation(id));
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

    return andThenAsync(await fileDomainService.deleteFilesOnMessages({ messageIds: [messageResult.value.id] }), () => this.delete(messageId));
  }

  async buildNextMessageRecord(request: CreateMessageInput): Promise<Result<InsertNextMessageRecord, ValidationError | StoreError>> {
    const validationResult = this.messageContentDomainService.validateMessageInput(request);

    if (!validationResult.ok) {
      return validationResult;
    }

    const timestamp = this.now();
    const timestampValidationResult = firstFailure(
      this.genericValidationService.requireValidDate(timestamp, "createdAt"),
      this.genericValidationService.requireValidDate(timestamp, "updatedAt"),
    );

    if (!timestampValidationResult.ok) {
      return timestampValidationResult;
    }

    const allMessagesResult = await this.messageRepository.selectAllMessagesByConversation(request.conversationId);

    if (!allMessagesResult.ok) {
      return allMessagesResult;
    }

    const latestSequenceNumber = allMessagesResult.value.reduce((highest, message) => Math.max(highest, message.sequenceNumber), 0);

    return {
      ok: true,
      value: {
        conversationId: request.conversationId,
        type: request.type,
        sequenceNumber: latestSequenceNumber + 1,
        content: request.content,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };
  }

  async createNextMessage(request: CreateMessageInput): Promise<Result<Message, ValidationError | StoreError>> {
    const nextMessageRecordResult = await this.buildNextMessageRecord(request);

    if (!nextMessageRecordResult.ok) {
      return nextMessageRecordResult;
    }

    return this.messageRepository.insertNextMessageRow({
      ...nextMessageRecordResult.value,
    });
  }
}
