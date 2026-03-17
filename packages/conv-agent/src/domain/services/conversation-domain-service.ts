import type {
  ConversationPageRequest,
  ConversationOffsetPageRequest,
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
    return this.conversationRepository.upsertConversationRow(record);
  }

  async readFromConversationDBStore(
    conversationId: string,
  ): Promise<Result<Conversation, ValidationError | NotFoundError | StoreError>> {
    const conversationIdResult = requireNonEmptyString(
      conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    return this.conversationRepository.selectConversationRow(
      conversationIdResult.value,
    );
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

    const pageRequest: ConversationOffsetPageRequest = {
      offset: (pageNumResult.value - 1) * pageSizeResult.value,
      pageSize: pageSizeResult.value,
    };

    return this.conversationRepository.selectConversationPage(pageRequest);
  }

  async removeFromConversationDBStore(
    conversationId: string,
  ): Promise<Result<void, ValidationError | StoreError>> {
    const conversationIdResult = requireNonEmptyString(
      conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    return this.conversationRepository.deleteConversationRow(
      conversationIdResult.value,
    );
  }
}
