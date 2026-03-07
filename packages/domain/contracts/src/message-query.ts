import type {
  ConversationId,
  Message,
  MessageId,
} from "@thoth/entities";

export interface CreateMessageQuery {
  message: Message;
}

export interface UpdateMessageQuery {
  message: Message;
}

export interface DeleteMessageQuery {
  conversation_id: ConversationId;
  messageId: MessageId;
}

export interface MessageQuery {
  createMessage(input: CreateMessageQuery): Promise<Message>;
  getMessageById(messageId: MessageId): Promise<Message | null>;
  listMessagesByConversationId(
    conversationId: ConversationId,
  ): Promise<Message[]>;
  updateMessage(input: UpdateMessageQuery): Promise<Message>;
  deleteMessage(input: DeleteMessageQuery): Promise<void>;
}
