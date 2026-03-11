import type { ConversationId, Message, MessageId } from "@thoth/entities";

export interface MessageRepository {
  create(message: Message): Promise<Message>;
  getById(messageId: MessageId): Promise<Message | null>;
  listByConversationId(conversationId: ConversationId): Promise<Message[]>;
  listByConversationIds(
    conversationIds: ConversationId[],
  ): Promise<Map<ConversationId, Message[]>>;
  delete(messageId: MessageId, conversationId: ConversationId): Promise<void>;
  deleteById(messageId: MessageId): Promise<void>;
}
