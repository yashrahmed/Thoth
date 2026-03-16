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

export class ConversationDomainService {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createConversation(): Promise<Result<Conversation, StoreError>> {
    const timestamp = this.now();

    return this.conversationRepository.create({
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async getConversation(
    conversationId: string,
  ): Promise<Result<Conversation, ValidationError | NotFoundError | StoreError>> {
    return this.conversationRepository.getById(conversationId);
  }

  async listConversationsPage(
    request: ConversationPageRequest,
  ): Promise<Result<Conversation[], ValidationError | StoreError>> {
    return this.conversationRepository.listPage(request);
  }

  async deleteConversation(
    conversationId: string,
  ): Promise<Result<void, ValidationError | StoreError>> {
    return this.conversationRepository.deleteById(conversationId);
  }
}
