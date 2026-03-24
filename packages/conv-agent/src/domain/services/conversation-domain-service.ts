import type { ConversationPageRequest, ConversationOffsetPageRequest, ConversationRepository } from "../contracts/conversation-repository";
import type { Conversation } from "../objects/conversation";
import type { NotFoundError, StoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";
import { andThenAsync } from "../objects/result";
import { requireNonEmptyString } from "../validation";

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

  async persistToConversationDBStore(record: { readonly createdAt: Date; readonly updatedAt: Date }): Promise<Result<Conversation, StoreError>> {
    return this.conversationRepository.upsertConversationRow(record);
  }

  async readFromConversationDBStore(conversationId: string): Promise<Result<Conversation, ValidationError | NotFoundError | StoreError>> {
    return andThenAsync(requireNonEmptyString(conversationId, "conversationId"), (id) =>
      this.conversationRepository.selectConversationRow(id),
    );
  }

  async readPageFromConversationDBStore(request: ConversationPageRequest): Promise<Result<Conversation[], StoreError>> {
    const pageRequest: ConversationOffsetPageRequest = {
      offset: (request.pageNum - 1) * request.pageSize,
      pageSize: request.pageSize,
    };

    return this.conversationRepository.selectConversationPage(pageRequest);
  }

  async removeFromConversationDBStore(conversationId: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(requireNonEmptyString(conversationId, "conversationId"), (id) =>
      this.conversationRepository.deleteConversationRow(id),
    );
  }
}
