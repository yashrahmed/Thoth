import type { MessageDomainService } from "../domain/services/message-domain-service";
import { type FileDomainService } from "../domain/services/file-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import { ValidationError, type LlmError, type NotFoundError, type StoreError } from "../domain/objects/errors";
import { failure, map, type Result } from "../domain/objects/result";
import { LLM_MESSAGE_TYPES, LLMMessageType } from "../domain/objects/llm";
import { type LlmDomainService } from "../domain/services/llm-domain-service";
import { type AppendMessageRequest } from "../domain/objects/append-message-request";

export { type AppendMessageRequest } from "../domain/objects/append-message-request";
export { type Attachment } from "../domain/objects/attachment";
export const MESSAGE_TYPES = LLM_MESSAGE_TYPES;

export class AppendMessageToConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
    private readonly llmDomainService: LlmDomainService,
  ) {}

  async execute(request: AppendMessageRequest): Promise<Result<void, ValidationError | NotFoundError | StoreError | LlmError>> {
    const conversationResult = await this.conversationDomainService.findById(request.conversationId);

    if (!conversationResult.ok) {
      return conversationResult;
    }

    if (request.content.trim().length === 0 && request.attachments.length === 0) {
      return failure(new ValidationError("content", "content must be a non-empty string when no files are attached."));
    }

    const createUserMessageResult = await this.messageDomainService.createNextMessage({
      conversationId: request.conversationId,
      type: request.type,
      content: request.content,
      fileIds: [],
    });

    if (!createUserMessageResult.ok) {
      return createUserMessageResult;
    }

    const uploadFilesResult = await this.fileDomainService.uploadFiles({
      files: request.attachments.map((attachment) => ({
        messageId: createUserMessageResult.value.id,
        content: attachment.content,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      })),
    });

    if (!uploadFilesResult.ok) {
      const deleteUserMessageResult = await this.messageDomainService.delete(createUserMessageResult.value.id);
      return deleteUserMessageResult.ok ? uploadFilesResult : deleteUserMessageResult;
    }

    const allMessagesResult = await this.messageDomainService.findAll(request.conversationId);

    if (!allMessagesResult.ok) {
      return allMessagesResult;
    }

    const llmResult = await this.llmDomainService.complete(allMessagesResult.value);

    if (!llmResult.ok) {
      return llmResult;
    }

    return map(
      await this.messageDomainService.createNextMessage({
        conversationId: request.conversationId,
        type: LLMMessageType.Assistant,
        content: llmResult.value.content,
        fileIds: [],
      }),
      () => undefined,
    );
  }
}
