import type {
  CreateMessageQuery,
  DeleteMessageQuery,
  MessageQuery,
} from "@thoth/contracts";
import type { Message } from "@thoth/entities";
import { MessageRepository } from "../repositories/message-repository";
import { FileService } from "./file-service";

export class MessageService implements MessageQuery {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly fileService: FileService,
  ) {}

  async createMessage(input: CreateMessageQuery): Promise<Message> {
    const now = new Date();
    let message = await this.messageRepository.createMessage({
      id: input.message.id,
      conversation_id: input.message.conversation_id,
      type: input.message.type,
      text_content: input.message.text_content,
      files: [],
      last_create_ts: now,
      last_update_ts: now,
    });

    try {
      const files = await this.fileService.storeFilesForMessage({
        messageId: message.id,
        files: input.files,
      });

      message = {
        ...message,
        files,
      };
    } catch (error) {
      await this.messageRepository.deleteMessageById(message.id);
      throw error;
    }

    return message;
  }

  getMessageById(messageId: string): Promise<Message | null> {
    return this.messageRepository.getMessageById(messageId);
  }

  listMessagesByConversationId(conversationId: string): Promise<Message[]> {
    return this.messageRepository.listMessagesByConversationId(conversationId);
  }

  async deleteMessage(input: DeleteMessageQuery): Promise<void> {
    const message = await this.messageRepository.getMessageById(input.messageId);

    if (!message || message.conversation_id !== input.conversation_id) {
      return;
    }

    await this.fileService.deleteFiles(message.files);
    await this.messageRepository.deleteMessage(
      input.messageId,
      input.conversation_id,
    );
  }
}
