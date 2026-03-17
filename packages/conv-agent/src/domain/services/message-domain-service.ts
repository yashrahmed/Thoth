import type {
  CreateMessageRecord,
  MessageRepository,
  MessagePageRequest,
  MessageSequencePageRequest,
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
import {
  requireNonEmptyString,
  requirePositiveInteger,
  requirePresent,
} from "../validation";

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

    const textContentResult = requirePresent(record.textContent, "textContent");

    if (!textContentResult.ok) {
      return textContentResult;
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
