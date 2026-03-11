import type {
  ConversationRepository,
  ConversationQuery,
  CreateConversationQuery,
  DeleteConversationQuery,
  MessageRepository,
  UpdateConversationQuery,
} from "@thoth/contracts";
import type { Conversation } from "@thoth/entities";
import { FileService } from "./file-service";

export class ConversationService implements ConversationQuery {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageRepository: MessageRepository,
    private readonly fileService: FileService,
  ) {}

  async createConversation(
    input: CreateConversationQuery,
  ): Promise<Conversation> {
    return this.conversationRepository.create(
      input.conversation.id,
      new Date(),
    );
  }

  async getConversationById(
    conversationId: string,
  ): Promise<Conversation | null> {
    const conversation =
      await this.conversationRepository.getById(conversationId);

    if (!conversation) {
      return null;
    }

    return {
      ...conversation,
      messages: await this.messageRepository.listByConversationId(
        conversationId,
      ),
    };
  }

  async listConversations(): Promise<Conversation[]> {
    const conversations = await this.conversationRepository.list();
    const messagesByConversationId =
      await this.messageRepository.listByConversationIds(
        conversations.map((conversation) => conversation.id),
      );

    return conversations.map((conversation) => ({
      ...conversation,
      messages: messagesByConversationId.get(conversation.id) ?? [],
    }));
  }

  async updateConversation(
    input: UpdateConversationQuery,
  ): Promise<Conversation> {
    const conversation = await this.conversationRepository.update(
      input.conversation.id,
      new Date(),
    );

    return {
      ...conversation,
      messages: await this.messageRepository.listByConversationId(
        conversation.id,
      ),
    };
  }

  async deleteConversation(input: DeleteConversationQuery): Promise<void> {
    const conversation = await this.getConversationById(input.conversation_id);

    if (!conversation) {
      return;
    }

    for (const message of conversation.messages) {
      await this.fileService.deleteFiles(message.files);
    }

    await this.conversationRepository.delete(input.conversation_id);
  }
}
