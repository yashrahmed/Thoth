import { CreateMessageRecord, type MessagePageRequest, type MessageRepository, type MessageSequencePageRequest } from "../contracts/message-repository";
import type { Message } from "../objects/message";
import { BlobStoreError, NotFoundError, ValidationError, type StoreError } from "../objects/errors";
import type { Result } from "../objects/result";
import { andThenAsync, traverseAsync } from "../objects/result";
import type { FileDomainService } from "./file-domain-service";
import { CreateNextMessageInput } from "../objects/message-input";
import type { MessageContentDomainService } from "./message-content-domain-service";
import { requireNonEmptyString } from "../validation";

export class MessageDomainService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly messageContentDomainService: MessageContentDomainService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async save(record: CreateMessageRecord): Promise<Result<Message, ValidationError | StoreError>> {
    return andThenAsync(this.messageContentDomainService.validateMessageRecord(record), () =>
      this.messageRepository.upsertMessageRow(record),
    );
  }

  async findById(messageId: string): Promise<Result<Message, ValidationError | NotFoundError | StoreError>> {
    return andThenAsync(requireNonEmptyString(messageId, "messageId"), (id) => this.messageRepository.selectMessageRow(id));
  }

  async findPage(request: MessagePageRequest): Promise<Result<Message[], StoreError>> {
    const pageRequest: MessageSequencePageRequest = {
      conversationId: request.conversationId,
      fromSequence: (request.pageNum - 1) * request.pageSize + 1,
      pageSize: request.pageSize,
    };

    return this.messageRepository.selectMessagePage(pageRequest);
  }

  async findAll(conversationId: string): Promise<Result<Message[], ValidationError | StoreError>> {
    return andThenAsync(requireNonEmptyString(conversationId, "conversationId"), (id) =>
      this.messageRepository.selectAllMessagesByConversation(id),
    );
  }

  async count(conversationId: string): Promise<Result<number, ValidationError | StoreError>> {
    return andThenAsync(requireNonEmptyString(conversationId, "conversationId"), (id) =>
      this.messageRepository.countMessagesByConversation(id),
    );
  }

  async delete(messageId: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(requireNonEmptyString(messageId, "messageId"), (id) => this.messageRepository.deleteMessageRow(id));
  }

  async deleteAll(conversationId: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(requireNonEmptyString(conversationId, "conversationId"), (id) =>
      this.messageRepository.deleteMessagesByConversation(id),
    );
  }

  async deleteMessage(messageId: string): Promise<Result<void, ValidationError | NotFoundError | StoreError>> {
    const messageResult = await this.findById(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    return this.delete(messageId);
  }

  async deleteMessageWithFiles(messageId: string, fileDomainService: FileDomainService): Promise<Result<void, NotFoundError | StoreError | ValidationError | BlobStoreError>> {
    const messageResult = await this.findById(messageId);

    if (!messageResult.ok) {
      return messageResult;
    }

    return andThenAsync(
      await traverseAsync(messageResult.value.fileIds, (fileId) => fileDomainService.deleteFile(fileId)),
      () => this.delete(messageId),
    );
  }

  async createNextMessage(request: CreateNextMessageInput): Promise<Result<Message, ValidationError | StoreError>> {
    const validationResult = this.messageContentDomainService.validateMessageInput(request);

    if (!validationResult.ok) {
      return validationResult;
    }

    const countResult = await this.count(request.conversationId);

    return andThenAsync(countResult, (count) => {
      const timestamp = this.now();

      return this.save(
        new CreateMessageRecord({
          conversationId: request.conversationId,
          type: request.type,
          sequenceNumber: count + 1,
          content: request.content,
          fileIds: request.fileIds,
          createdAt: timestamp,
          updatedAt: timestamp,
        }),
      );
    });
  }
}
