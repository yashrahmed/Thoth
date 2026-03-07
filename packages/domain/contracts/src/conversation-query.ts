import type { Conversation, ConversationId } from "@thoth/entities";

export interface CreateConversationQuery {
  conversation: Conversation;
}

export interface UpdateConversationQuery {
  conversation: Conversation;
}

export interface DeleteConversationQuery {
  conversation_id: ConversationId;
}

export interface ConversationQuery {
  createConversation(input: CreateConversationQuery): Promise<Conversation>;
  getConversationById(
    conversationId: ConversationId,
  ): Promise<Conversation | null>;
  listConversations(): Promise<Conversation[]>;
  updateConversation(input: UpdateConversationQuery): Promise<Conversation>;
  deleteConversation(input: DeleteConversationQuery): Promise<void>;
}
