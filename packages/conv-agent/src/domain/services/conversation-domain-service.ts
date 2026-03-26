import type { ConversationRepository } from "../contracts/conversation-repository";
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

    return this.conversationRepository.upsertConversationRow({
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async findById(conversationId: string): Promise<Result<Conversation, ValidationError | NotFoundError | StoreError>> {
    return andThenAsync(requireNonEmptyString(conversationId, "conversationId"), (id) => this.conversationRepository.selectConversationRow(id));
  }

  async findPage(request: { readonly pageNum: number; readonly pageSize: number }): Promise<Result<Conversation[], StoreError>> {
    return this.conversationRepository.selectConversationPage(request);
  }

  async delete(conversationId: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(requireNonEmptyString(conversationId, "conversationId"), (id) => this.conversationRepository.deleteConversationRow(id));
  }
}
