import type {
  CreateMessageQuery,
  DeleteMessageQuery,
  MessageQuery,
  UpdateMessageQuery,
} from "@thoth/contracts";
import type { ConversationId, Message, MessageId } from "@thoth/entities";

export class MessageRepository implements MessageQuery {
  private readonly messagesById = new Map<MessageId, Message>();
  private readonly messageIdsByConversationId = new Map<
    ConversationId,
    MessageId[]
  >();

  async createMessage(input: CreateMessageQuery): Promise<Message> {
    const { conversationId, message } = input;
    const existingMessage = this.messagesById.get(message.id);

    if (existingMessage) {
      throw new Error(`Message with id "${message.id}" already exists.`);
    }

    this.messagesById.set(message.id, message);

    const messageIds =
      this.messageIdsByConversationId.get(conversationId) ?? [];

    this.messageIdsByConversationId.set(conversationId, [
      ...messageIds,
      message.id,
    ]);

    return message;
  }

  async getMessageById(messageId: MessageId): Promise<Message | null> {
    return this.messagesById.get(messageId) ?? null;
  }

  async listMessagesByConversationId(
    conversationId: ConversationId,
  ): Promise<Message[]> {
    const messageIds =
      this.messageIdsByConversationId.get(conversationId) ?? [];

    return messageIds
      .map((messageId) => this.messagesById.get(messageId))
      .filter((message): message is Message => message !== undefined);
  }

  async updateMessage(input: UpdateMessageQuery): Promise<Message> {
    const { message } = input;

    if (!this.messagesById.has(message.id)) {
      throw new Error(`Message with id "${message.id}" does not exist.`);
    }

    this.messagesById.set(message.id, message);

    return message;
  }

  async deleteMessage(input: DeleteMessageQuery): Promise<void> {
    const { conversationId, messageId } = input;

    this.messagesById.delete(messageId);

    const messageIds =
      this.messageIdsByConversationId.get(conversationId) ?? [];

    this.messageIdsByConversationId.set(
      conversationId,
      messageIds.filter((currentMessageId) => currentMessageId !== messageId),
    );
  }
}
