import {
  ApplicationError,
  type AttachmentDto,
  type AttachmentUpload,
  type ConversationDto,
  type ConversationsApplicationService,
  type DeleteConversationCommand,
  type DeleteMessageCommand,
  type MessageDto,
  type PostMessageCommand,
  type CreateConversationCommand,
} from "@thoth/contracts";
import {
  Attachment,
  AttachmentId,
  assertMessageRole,
  type BlobStore,
  Conversation,
  ConversationId,
  type ConversationRepository,
  Message,
  MessageId,
} from "@thoth/entities";

export class ConversationsService implements ConversationsApplicationService {
  public constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly blobStore: BlobStore,
  ) {}

  public async createConversation(
    input: CreateConversationCommand,
  ): Promise<ConversationDto> {
    const now = new Date();
    const conversation = Conversation.createNew({
      id: new ConversationId(input.conversationId ?? crypto.randomUUID()),
      createdAt: now,
    });

    await this.conversationRepository.save(conversation);

    return serializeConversation(conversation);
  }

  public async getConversationById(
    conversationId: string,
  ): Promise<ConversationDto | null> {
    const conversation = await this.conversationRepository.getById(
      new ConversationId(conversationId),
    );

    return conversation ? serializeConversation(conversation) : null;
  }

  public async listConversations(): Promise<ConversationDto[]> {
    const conversations = await this.conversationRepository.list();

    return conversations.map((conversation) => serializeConversation(conversation));
  }

  public async postMessage(input: PostMessageCommand): Promise<MessageDto> {
    const conversation = await this.requireConversation(input.conversationId);
    const occurredAt = new Date();
    const messageId = new MessageId(input.messageId ?? crypto.randomUUID());
    const attachments = input.attachments.map((upload) =>
      this.buildAttachment(conversation.id, messageId, upload, occurredAt),
    );

    let message: Message;

    try {
      message = conversation.postMessage({
        id: messageId,
        role: assertMessageRole(input.role),
        textContent: input.textContent,
        attachments,
        occurredAt,
      });
    } catch (error) {
      throw toApplicationError(error);
    }

    const persistedConversation = conversation.withUpdatedTimestamp(occurredAt);
    const uploadedObjectKeys: string[] = [];

    try {
      await this.uploadAttachments(input.attachments, attachments, uploadedObjectKeys);
      await this.conversationRepository.save(persistedConversation);
    } catch (error) {
      await this.cleanupObjects(uploadedObjectKeys);
      throw error;
    }

    return serializeMessage(message);
  }

  public async deleteConversation(
    input: DeleteConversationCommand,
  ): Promise<void> {
    const conversation = await this.requireConversation(input.conversationId);

    for (const message of conversation.messages) {
      await this.cleanupObjects(message.attachments.map((attachment) => attachment.objectKey));
    }

    await this.conversationRepository.delete(conversation.id);
  }

  public async deleteMessage(input: DeleteMessageCommand): Promise<void> {
    const conversation = await this.requireConversation(input.conversationId);
    const messageId = new MessageId(input.messageId);
    const removedAt = new Date();
    const removedMessage = conversation.removeMessage(messageId, removedAt);

    if (!removedMessage) {
      throw new ApplicationError(
        "NOT_FOUND",
        `Message "${input.messageId}" was not found in conversation "${input.conversationId}".`,
      );
    }

    await this.cleanupObjects(
      removedMessage.attachments.map((attachment) => attachment.objectKey),
    );
    await this.conversationRepository.save(
      conversation.withUpdatedTimestamp(removedAt),
    );
  }

  private buildAttachment(
    conversationId: ConversationId,
    messageId: MessageId,
    upload: AttachmentUpload,
    createdAt: Date,
  ): Attachment {
    const attachmentId = new AttachmentId(crypto.randomUUID());

    return new Attachment({
      id: attachmentId,
      objectKey: buildObjectKey(conversationId, messageId, attachmentId, upload.originalFilename),
      originalFilename: upload.originalFilename,
      mediaType: upload.mediaType,
      byteSize: upload.byteSize,
      createdAt,
    });
  }

  private async requireConversation(conversationId: string): Promise<Conversation> {
    const conversation = await this.conversationRepository.getById(
      new ConversationId(conversationId),
    );

    if (!conversation) {
      throw new ApplicationError(
        "NOT_FOUND",
        `Conversation "${conversationId}" was not found.`,
      );
    }

    return conversation;
  }

  private async uploadAttachments(
    uploads: AttachmentUpload[],
    attachments: Attachment[],
    uploadedObjectKeys: string[],
  ): Promise<void> {
    for (const [index, attachment] of attachments.entries()) {
      const upload = uploads[index];

      if (!upload) {
        throw new Error("Attachment upload payload is missing.");
      }

      await this.blobStore.putObject({
        objectKey: attachment.objectKey,
        body: upload.body,
        contentType: upload.mediaType,
        byteSize: upload.byteSize,
      });
      uploadedObjectKeys.push(attachment.objectKey);
    }
  }

  private async cleanupObjects(objectKeys: string[]): Promise<void> {
    for (const objectKey of objectKeys) {
      try {
        await this.blobStore.deleteObject({ objectKey });
      } catch {
        // Best-effort cleanup avoids hiding the original failure.
      }
    }
  }
}

function serializeConversation(conversation: Conversation): ConversationDto {
  return {
    id: conversation.id.value,
    messages: conversation.messages.map((message) => serializeMessage(message)),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

function serializeMessage(message: Message): MessageDto {
  return {
    id: message.id.value,
    role: message.role,
    textContent: message.textContent,
    attachments: message.attachments.map((attachment) => serializeAttachment(attachment)),
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

function serializeAttachment(attachment: Attachment): AttachmentDto {
  return {
    id: attachment.id.value,
    objectKey: attachment.objectKey,
    originalFilename: attachment.originalFilename,
    mediaType: attachment.mediaType,
    byteSize: attachment.byteSize,
    createdAt: attachment.createdAt.toISOString(),
  };
}

function buildObjectKey(
  conversationId: ConversationId,
  messageId: MessageId,
  attachmentId: AttachmentId,
  originalFilename: string,
): string {
  const extension = sanitizeExtension(originalFilename);
  const suffix = extension ? `.${extension}` : "";

  return `conversations/${conversationId.value}/${messageId.value}/${attachmentId.value}${suffix}`;
}

function sanitizeExtension(originalFilename: string): string | null {
  const extension = originalFilename.trim().split(".").pop() ?? "";
  const normalized = extension.toLowerCase().replace(/[^a-z0-9]/g, "");

  return normalized ? normalized : null;
}

function toApplicationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) {
    return error;
  }

  if (error instanceof Error) {
    return new ApplicationError("VALIDATION", error.message);
  }

  return new ApplicationError("VALIDATION", "Request could not be processed.");
}
