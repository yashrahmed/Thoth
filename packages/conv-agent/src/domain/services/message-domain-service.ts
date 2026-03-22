import { CreateMessageRecord, type MessagePageRequest, type MessageRepository, type MessageSequencePageRequest } from "../contracts/message-repository";
import type { Message } from "../objects/message";
import { BlobStoreError, NotFoundError, ValidationError, type StoreError } from "../objects/errors";
import type { Result } from "../objects/result";
import type { FileDomainService } from "./file-domain-service";
import { CreateMessageInput, CreateNextMessageInput } from "../objects/message-input";
import type { MessageContentDomainService } from "./message-content-domain-service";
import { requireNonEmptyString } from "../validation";

export class MessageDomainService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly messageContentDomainService: MessageContentDomainService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createMessage(request: CreateMessageInput): Promise<Result<Message, ValidationError | StoreError>> {
    const validationResult = this.messageContentDomainService.validateMessageInput(request);

    if (!validationResult.ok) {
      return validationResult;
    }

    return this.persistToMessageDBStore(this.buildRecord(request));
  }

  async persistToMessageDBStore(record: CreateMessageRecord): Promise<Result<Message, ValidationError | StoreError>> {
    const validationResult = this.messageContentDomainService.validateMessageRecord(record);

    if (!validationResult.ok) {
      return validationResult;
    }

    return this.messageRepository.upsertMessageRow(record);
  }

  async readFromMessageDBStore(messageId: string): Promise<Result<Message, ValidationError | NotFoundError | StoreError>> {
    const messageIdResult = requireNonEmptyString(messageId, "messageId");

    if (!messageIdResult.ok) {
      return messageIdResult;
    }

    return this.messageRepository.selectMessageRow(messageIdResult.value);
  }

  async readPageFromMessageDBStore(request: MessagePageRequest): Promise<Result<Message[], StoreError>> {
    const pageRequest: MessageSequencePageRequest = {
      conversationId: request.conversationId,
      fromSequence: (request.pageNum - 1) * request.pageSize + 1,
      pageSize: request.pageSize,
    };

    return this.messageRepository.selectMessagePage(pageRequest);
  }

  async readAllMessagesFromMessageDBStore(conversationId: string): Promise<Result<Message[], ValidationError | StoreError>> {
    const conversationIdResult = requireNonEmptyString(conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    return this.messageRepository.selectAllMessagesByConversation(conversationIdResult.value);
  }

  async readMessageCountFromMessageDBStore(conversationId: string): Promise<Result<number, ValidationError | StoreError>> {
    const conversationIdResult = requireNonEmptyString(conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    return this.messageRepository.countMessagesByConversation(conversationIdResult.value);
  }

  async removeFromMessageDBStore(messageId: string): Promise<Result<void, ValidationError | StoreError>> {
    const messageIdResult = requireNonEmptyString(messageId, "messageId");

    if (!messageIdResult.ok) {
      return messageIdResult;
    }

    return this.messageRepository.deleteMessageRow(messageIdResult.value);
  }

  async deleteMessage(messageId: string): Promise<Result<void, ValidationError | NotFoundError | StoreError>> {
    const messageResult = await this.readFromMessageDBStore(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    return this.removeFromMessageDBStore(messageId);
  }

  async deleteMessageWithFiles(messageId: string, fileDomainService: FileDomainService): Promise<Result<void, NotFoundError | StoreError | ValidationError | BlobStoreError>> {
    const messageResult = await this.readFromMessageDBStore(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    for (const fileId of this.messageContentDomainService.collectBlobPartFileIds(messageResult.value.content)) {
      const deleteFileResult = await fileDomainService.deleteFile(fileId);

      if (!deleteFileResult.ok) {
        return deleteFileResult;
      }
    }

    return this.removeFromMessageDBStore(messageId);
  }

  async createNextMessage(request: CreateNextMessageInput): Promise<Result<Message, ValidationError | StoreError>> {
    const validationResult = this.messageContentDomainService.validateMessageInput(
      new CreateMessageInput({
        conversationId: request.conversationId,
        type: request.type,
        sequenceNumber: 1,
        content: request.content,
      }),
    );

    if (!validationResult.ok) {
      return validationResult;
    }

    const countResult = await this.readMessageCountFromMessageDBStore(request.conversationId);

    if (!countResult.ok) {
      return countResult;
    }

    return this.createMessage(
      new CreateMessageInput({
        conversationId: request.conversationId,
        type: request.type,
        sequenceNumber: countResult.value + 1,
        content: request.content,
      }),
    );
  }

  private buildRecord(request: CreateMessageInput): CreateMessageRecord {
    const timestamp = this.now();

    return new CreateMessageRecord({
      conversationId: request.conversationId,
      type: request.type,
      sequenceNumber: request.sequenceNumber,
      content: request.content,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
}
