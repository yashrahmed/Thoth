import type {
  ConversationQuery,
  CreateConversationQuery,
  DeleteConversationQuery,
  UpdateConversationQuery,
} from "@thoth/contracts";
import type { Conversation } from "@thoth/entities";
import { ConversationRepository } from "../repositories/conversation-repository";
import { MessageRepository } from "../repositories/message-repository";
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
    return this.conversationRepository.createConversation(
      input.conversation.id,
      new Date(),
    );
  }

  async getConversationById(
    conversationId: string,
  ): Promise<Conversation | null> {
    const conversation =
      await this.conversationRepository.getConversationById(conversationId);

    if (!conversation) {
      return null;
    }

    return {
      ...conversation,
      messages: await this.messageRepository.listMessagesByConversationId(
        conversationId,
      ),
    };
  }

  async listConversations(): Promise<Conversation[]> {
    const conversations = await this.conversationRepository.listConversations();
    const messagesByConversationId =
      await this.messageRepository.listMessagesByConversationIds(
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
    const conversation = await this.conversationRepository.updateConversation(
      input.conversation.id,
      new Date(),
    );

    return {
      ...conversation,
      messages: await this.messageRepository.listMessagesByConversationId(
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

    await this.conversationRepository.deleteConversation(input.conversation_id);
  }
}
