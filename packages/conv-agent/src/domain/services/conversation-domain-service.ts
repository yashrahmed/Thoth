import type {
  ConversationPageRequest,
  ConversationRepository,
} from "../contracts/conversation-repository";
import type { Conversation } from "../objects/conversation";
import type {
  NotFoundError,
  StoreError,
  ValidationError,
} from "../objects/errors";
import type { Result } from "../objects/result";
import {
  requireNonEmptyString,
  requirePositiveInteger,
} from "../validation";

export class ConversationDomainService {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createConversation(): Promise<Result<Conversation, StoreError>> {
    const timestamp = this.now();

    return this.persistToConversationDBStore({
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async persistToConversationDBStore(
    record: { readonly createdAt: Date; readonly updatedAt: Date },
  ): Promise<Result<Conversation, StoreError>> {
    return this.conversationRepository.persistToConversationDBStore(record);
  }

  async readFromConversationDBStore(
    id: string,
  ): Promise<Result<Conversation, ValidationError | NotFoundError | StoreError>> {
    const idResult = requireNonEmptyString(id, "id");

    if (!idResult.ok) {
      return idResult;
    }

    return this.conversationRepository.readFromConversationDBStore(idResult.value);
  }

  async readPageFromConversationDBStore(
    request: ConversationPageRequest,
  ): Promise<Result<Conversation[], ValidationError | StoreError>> {
    const pageNumResult = requirePositiveInteger(request.pageNum, "pageNum");

    if (!pageNumResult.ok) {
      return pageNumResult;
    }

    const pageSizeResult = requirePositiveInteger(request.pageSize, "pageSize");

    if (!pageSizeResult.ok) {
      return pageSizeResult;
    }

    return this.conversationRepository.readPageFromConversationDBStore({
      pageNum: pageNumResult.value,
      pageSize: pageSizeResult.value,
    });
  }

  async removeFromConversationDBStore(
    id: string,
  ): Promise<Result<void, ValidationError | StoreError>> {
    const idResult = requireNonEmptyString(id, "id");

    if (!idResult.ok) {
      return idResult;
    }

    return this.conversationRepository.removeFromConversationDBStore(idResult.value);
  }
}
