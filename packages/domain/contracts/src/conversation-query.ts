import type { Conversation, ConversationId } from "@thoth/entities";

export interface ConversationMutationInput {
  id: ConversationId;
}

export interface CreateConversationQuery {
  conversation: ConversationMutationInput;
}

export interface UpdateConversationQuery {
  conversation: ConversationMutationInput;
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
