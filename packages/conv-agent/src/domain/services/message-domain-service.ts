import type {
  CreateMessageRecord,
  MessageRepository,
  MessagePageRequest,
} from "../contracts/message-repository";
import type { Message } from "../objects/message";
import type {
  BlobStoreError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../objects/errors";
import type { Result } from "../objects/result";
import type { FileDomainService } from "./file-domain-service";
import { requireNonEmptyString } from "../validation";

export interface CreateMessageInput {
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly fileIds: ReadonlyArray<string>;
}

export interface CreateNextMessageInput {
  readonly conversationId: string;
  readonly textContent: string;
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
    return this.messageRepository.create(this.buildRecord(request));
  }

  async getMessage(
    messageId: string,
  ): Promise<Result<Message, ValidationError | NotFoundError | StoreError>> {
    const messageIdResult = requireNonEmptyString(messageId, "messageId");

    if (!messageIdResult.ok) {
      return messageIdResult;
    }

    return this.messageRepository.getById(messageId);
  }

  async removeMessageRecord(
    messageId: string,
  ): Promise<Result<void, ValidationError | StoreError>> {
    const messageIdResult = requireNonEmptyString(messageId, "messageId");

    if (!messageIdResult.ok) {
      return messageIdResult;
    }

    return this.messageRepository.deleteById(messageId);
  }

  async deleteMessage(
    messageId: string,
  ): Promise<Result<void, ValidationError | NotFoundError | StoreError>> {
    const messageResult = await this.getMessage(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    return this.removeMessageRecord(messageId);
  }

  async deleteMessageWithFiles(
    messageId: string,
    fileDomainService: FileDomainService,
  ): Promise<Result<void, NotFoundError | StoreError | ValidationError | BlobStoreError>> {
    const messageResult = await this.getMessage(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    for (const fileId of messageResult.value.fileIds) {
      const deleteFileResult = await fileDomainService.deleteFile(fileId);

      if (!deleteFileResult.ok) {
        return deleteFileResult;
      }
    }

    return this.removeMessageRecord(messageId);
  }

  async listPageByConversation(
    request: MessagePageRequest,
  ): Promise<Result<Message[], ValidationError | StoreError>> {
    return this.listMessagesPage(request);
  }

  async listMessagesPage(
    request: MessagePageRequest,
  ): Promise<Result<Message[], ValidationError | StoreError>> {
    return this.messageRepository.listPageByConversation(request);
  }

  async listByConversation(
    conversationId: string,
  ): Promise<Result<Message[], ValidationError | StoreError>> {
    return this.listMessagesByConversation(conversationId);
  }

  async listMessagesByConversation(
    conversationId: string,
  ): Promise<Result<Message[], ValidationError | StoreError>> {
    return this.messageRepository.listByConversation(conversationId);
  }

  async countByConversation(
    conversationId: string,
  ): Promise<Result<number, ValidationError | StoreError>> {
    return this.countMessagesByConversation(conversationId);
  }

  async countMessagesByConversation(
    conversationId: string,
  ): Promise<Result<number, ValidationError | StoreError>> {
    return this.messageRepository.countByConversation(conversationId);
  }

  async createNextMessage(
    request: CreateNextMessageInput,
  ): Promise<Result<Message, ValidationError | StoreError>> {
    const countResult = await this.countMessagesByConversation(
      request.conversationId,
    );

    if (!countResult.ok) {
      return countResult;
    }

    return this.createMessage({
      conversationId: request.conversationId,
      sequenceNumber: countResult.value + 1,
      textContent: request.textContent,
      fileIds: request.fileIds,
    });
  }

  private buildRecord(request: CreateMessageInput): CreateMessageRecord {
    const timestamp = this.now();

    return {
      conversationId: request.conversationId,
      sequenceNumber: request.sequenceNumber,
      textContent: request.textContent,
      fileIds: request.fileIds,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }
}
