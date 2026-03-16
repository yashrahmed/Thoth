import type {
  CreateMessageRecord,
  MessageRepository,
  MessagePageRequest,
} from "../contracts/message-repository";
import type { Message } from "../objects/message";
import type {
  ConstructionError,
  BlobStoreError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../objects/errors";
import type { Result } from "../objects/result";
import {
  requireNonEmptyString,
  requirePositiveInteger,
  requirePresent,
} from "../validators";
import type { FileDomainService } from "./file-domain-service";

export interface CreateMessageRequest {
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly fileIds: ReadonlyArray<string>;
}

export interface CreateNextMessageRequest {
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
    request: CreateMessageRequest,
  ): Promise<Result<Message, ValidationError | ConstructionError | StoreError>> {
    const conversationIdResult = requireNonEmptyString(
      request.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const sequenceNumberResult = requirePositiveInteger(
      request.sequenceNumber,
      "sequenceNumber",
    );

    if (!sequenceNumberResult.ok) {
      return sequenceNumberResult;
    }

    const textContentResult = requirePresent(request.textContent, "textContent");

    if (!textContentResult.ok) {
      return textContentResult;
    }

    for (const fileId of request.fileIds) {
      const fileIdResult = requireNonEmptyString(fileId, "fileId");

      if (!fileIdResult.ok) {
        return fileIdResult;
      }
    }

    return this.messageRepository.create(this.buildRecord(request));
  }

  async getMessage(
    messageId: string,
  ): Promise<Result<Message, NotFoundError | StoreError>> {
    return this.messageRepository.getById(messageId);
  }

  async deleteMessage(
    messageId: string,
  ): Promise<Result<void, NotFoundError | StoreError>> {
    const messageResult = await this.messageRepository.getById(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    return this.messageRepository.deleteById(messageId);
  }

  async deleteMessageWithFiles(
    messageId: string,
    fileDomainService: FileDomainService,
  ): Promise<Result<void, NotFoundError | StoreError | BlobStoreError>> {
    const messageResult = await this.messageRepository.getById(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    for (const fileId of messageResult.value.fileIds) {
      const deleteFileResult = await fileDomainService.deleteFile(fileId);

      if (!deleteFileResult.ok) {
        return deleteFileResult;
      }
    }

    return this.messageRepository.deleteById(messageId);
  }

  async listPageByConversation(
    request: MessagePageRequest,
  ): Promise<Result<Message[], StoreError>> {
    return this.messageRepository.listPageByConversation(request);
  }

  async listByConversation(
    conversationId: string,
  ): Promise<Result<Message[], StoreError>> {
    return this.messageRepository.listByConversation(conversationId);
  }

  async countByConversation(
    conversationId: string,
  ): Promise<Result<number, StoreError>> {
    return this.messageRepository.countByConversation(conversationId);
  }

  async createNextMessage(
    request: CreateNextMessageRequest,
  ): Promise<Result<Message, ValidationError | ConstructionError | StoreError>> {
    const conversationIdResult = requireNonEmptyString(
      request.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const textContentResult = requirePresent(request.textContent, "textContent");

    if (!textContentResult.ok) {
      return textContentResult;
    }

    for (const fileId of request.fileIds) {
      const fileIdResult = requireNonEmptyString(fileId, "fileId");

      if (!fileIdResult.ok) {
        return fileIdResult;
      }
    }

    const countResult = await this.messageRepository.countByConversation(
      conversationIdResult.value,
    );

    if (!countResult.ok) {
      return countResult;
    }

    return this.createMessage({
      conversationId: conversationIdResult.value,
      sequenceNumber: countResult.value + 1,
      textContent: request.textContent,
      fileIds: request.fileIds,
    });
  }

  private buildRecord(request: CreateMessageRequest): CreateMessageRecord {
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
