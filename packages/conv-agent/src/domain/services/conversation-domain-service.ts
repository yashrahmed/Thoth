import type { ConversationRepository } from "../contracts/conversation-repository";
import type { Conversation } from "../objects/conversation";
import { EntityType, StoreError, StoreOperation, ValidationError, type NotFoundError } from "../objects/errors";
import type { Result } from "../objects/result";
import { andThenAsync, failure, firstFailure, success } from "../objects/result";
import { GenericValidationService } from "./generic-validation-service";

export class ConversationDomainService {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly genericValidationService: GenericValidationService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createConversation(): Promise<Result<Conversation, StoreError>> {
    const timestamp = this.now();
    const recordValidationResult = this.validateConversationRecord({
      title: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    if (!recordValidationResult.ok) {
      return failure(new StoreError(EntityType.Conversation, StoreOperation.Persist, recordValidationResult.error.message));
    }

    const result = await this.conversationRepository.upsertConversationRow({
      title: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return result.ok ? this.validateConversation(result.value, StoreOperation.Persist) : result;
  }

  async findById(conversationId: string): Promise<Result<Conversation, ValidationError | NotFoundError | StoreError>> {
    return andThenAsync(this.genericValidationService.requireNonEmptyString(conversationId, "conversationId"), async (id) => {
      const result = await this.conversationRepository.selectConversationRow(id);

      return result.ok ? this.validateConversation(result.value, StoreOperation.Read) : result;
    });
  }

  async findPage(request: { readonly pageNum: number; readonly pageSize: number }): Promise<Result<Conversation[], StoreError>> {
    const result = await this.conversationRepository.selectConversationPage(request);

    if (!result.ok) {
      return result;
    }

    const conversations: Conversation[] = [];

    for (const conversation of result.value) {
      const validationResult = this.validateConversation(conversation, StoreOperation.ReadPage);

      if (!validationResult.ok) {
        return validationResult;
      }

      conversations.push(validationResult.value);
    }

    return success(conversations);
  }

  async renameConversation(conversationId: string, title: string | null): Promise<Result<Conversation, ValidationError | NotFoundError | StoreError>> {
    const conversationIdResult = this.genericValidationService.requireNonEmptyString(conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const titleResult = this.normalizeConversationTitle(title);

    if (!titleResult.ok) {
      return titleResult;
    }

    const updatedAt = this.now();
    const updatedAtResult = this.genericValidationService.requireValidDate(updatedAt, "updatedAt");

    if (!updatedAtResult.ok) {
      return updatedAtResult;
    }

    const result = await this.conversationRepository.updateConversationTitleRow({
      conversationId: conversationIdResult.value,
      title: titleResult.value,
      updatedAt,
    });

    return result.ok ? this.validateConversation(result.value, StoreOperation.Update) : result;
  }

  async delete(conversationId: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(this.genericValidationService.requireNonEmptyString(conversationId, "conversationId"), (id) => this.conversationRepository.deleteConversationRow(id));
  }

  private validateConversationRecord(record: Omit<Conversation, "id">): Result<void, ValidationError> {
    return firstFailure(
      this.validateConversationTitle(record.title),
      this.genericValidationService.requireValidDate(record.createdAt, "createdAt"),
      this.genericValidationService.requireValidDate(record.updatedAt, "updatedAt"),
    );
  }

  private validateConversation(conversation: Conversation, operation: StoreOperation): Result<Conversation, StoreError> {
    const validationResult = firstFailure(
      this.genericValidationService.requireNonEmptyString(conversation.id, "id"),
      this.validateConversationTitle(conversation.title),
      this.genericValidationService.requireValidDate(conversation.createdAt, "createdAt"),
      this.genericValidationService.requireValidDate(conversation.updatedAt, "updatedAt"),
    );

    return validationResult.ok ? success(conversation) : failure(new StoreError(EntityType.Conversation, operation, validationResult.error.message));
  }

  private validateConversationTitle(title: string | null): Result<void, ValidationError> {
    if (title === null) {
      return success(undefined);
    }

    const titleResult = this.genericValidationService.requireNonEmptyString(title, "title");

    return titleResult.ok ? success(undefined) : titleResult;
  }

  private normalizeConversationTitle(title: string | null): Result<string, ValidationError> {
    if (title === null) {
      return failure(new ValidationError("title", "title must be present."));
    }

    const normalizedTitle = title.trim();
    const titleResult = this.genericValidationService.requireNonEmptyString(normalizedTitle, "title");

    return titleResult.ok ? success(normalizedTitle) : titleResult;
  }
}
