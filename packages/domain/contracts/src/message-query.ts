import type {
  ConversationId,
  MessageId,
  Message,
  MessageType,
} from "@thoth/entities";

export interface CreateMessageInput {
  id: MessageId;
  conversation_id: ConversationId;
  type: MessageType;
  text_content: string | null;
}

export interface MessageUploadInput {
  original_filename: string;
  content_type: string;
  byte_size: number;
  body: ArrayBuffer;
}

export interface CreateMessageQuery {
  message: CreateMessageInput;
  files: MessageUploadInput[];
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
  deleteMessage(input: DeleteMessageQuery): Promise<void>;
}
