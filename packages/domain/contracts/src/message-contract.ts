import type {
  ConversationId,
  Message,
  MessageId,
} from "@thoth/entities";

export interface CreateMessageInput {
  conversationId: ConversationId;
  message: Message;
}

export interface UpdateMessageInput {
  conversationId: ConversationId;
  message: Message;
}

export interface DeleteMessageInput {
  conversationId: ConversationId;
  messageId: MessageId;
}

export interface MessageContract {
  createMessage(input: CreateMessageInput): Promise<Message>;
  getMessageById(messageId: MessageId): Promise<Message | null>;
  listMessagesByConversationId(
    conversationId: ConversationId,
  ): Promise<Message[]>;
  updateMessage(input: UpdateMessageInput): Promise<Message>;
  deleteMessage(input: DeleteMessageInput): Promise<void>;
}
