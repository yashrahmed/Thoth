import type { Conversation, ConversationId } from "@thoth/entities";

export interface ConversationRepository {
  create(conversationId: ConversationId, createdAt: Date): Promise<Conversation>;
  getById(conversationId: ConversationId): Promise<Conversation | null>;
  list(): Promise<Conversation[]>;
  update(
    conversationId: ConversationId,
    updatedAt: Date,
  ): Promise<Conversation>;
  delete(conversationId: ConversationId): Promise<void>;
}
