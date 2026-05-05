import type { AppendUserMessageDomainService } from "../domain/services/append-user-message-domain-service";
import { type FileDomainService } from "../domain/services/file-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { LlmCompletionDispatchDomainService } from "../domain/services/llm-completion-dispatch-domain-service";
import type { MessageDomainService } from "../domain/services/message-domain-service";
import { ValidationError, type NotFoundError, type StoreError } from "../domain/objects/errors";
import { failure, type Result } from "../domain/objects/result";
import { LLM_MESSAGE_TYPES } from "../domain/objects/llm";
import { type AppendMessageRequest } from "../domain/objects/request-types";
import type { AppendMessageRecord } from "../domain/objects/message-types";

export { type AppendMessageRequest } from "../domain/objects/request-types";
export { type Attachment } from "../domain/objects/request-types";
export const MESSAGE_TYPES = LLM_MESSAGE_TYPES;

export class AppendMessageToConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly appendUserMessageDomainService: AppendUserMessageDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
    private readonly llmCompletionDispatchDomainService: LlmCompletionDispatchDomainService,
  ) {}

  async execute(request: AppendMessageRequest): Promise<Result<void, ValidationError | NotFoundError | StoreError>> {
    const conversationResult = await this.conversationDomainService.findById(request.conversationId);

    if (!conversationResult.ok) {
      return conversationResult;
    }

    if (request.content.trim().length === 0 && request.attachments.length === 0) {
      return failure(new ValidationError("content", "content must be a non-empty string when no files are attached."));
    }

    const uploadFilesResult = await this.fileDomainService.uploadBlobs({
      files: request.attachments.map((attachment) => ({
        content: attachment.content,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      })),
    });

    if (!uploadFilesResult.ok) {
      return uploadFilesResult;
    }

    const nextMessageRecordResult = await this.buildUserMessageRecord(request);

    if (!nextMessageRecordResult.ok) {
      const deleteUploadedBlobsResult = await this.fileDomainService.deleteUploadedBlobs({ files: uploadFilesResult.value });
      return deleteUploadedBlobsResult.ok ? nextMessageRecordResult : deleteUploadedBlobsResult;
    }

    const createUserMessageResult = await this.appendUserMessageDomainService.persistUserMessageWithFiles({
      message: nextMessageRecordResult.value,
      files: uploadFilesResult.value,
    });

    if (!createUserMessageResult.ok) {
      const deleteUploadedBlobsResult = await this.fileDomainService.deleteUploadedBlobs({ files: uploadFilesResult.value });
      return deleteUploadedBlobsResult.ok ? createUserMessageResult : deleteUploadedBlobsResult;
    }

    const dispatchResult = await this.llmCompletionDispatchDomainService.dispatchCompletion({
      messageId: createUserMessageResult.value.id,
    });

    if (!dispatchResult.ok) {
      return dispatchResult;
    }

    return { ok: true, value: undefined };
  }

  private async buildUserMessageRecord(request: AppendMessageRequest): Promise<Result<AppendMessageRecord, ValidationError>> {
    const recordsResult = await this.messageDomainService.buildNextMessageRecords({
      conversationId: request.conversationId,
      messages: [{ type: request.type, content: request.content }],
    });

    if (!recordsResult.ok) {
      return recordsResult;
    }

    const record = recordsResult.value[0];

    return record ? { ok: true, value: record } : failure(new ValidationError("messages", "messages must contain at least one message."));
  }
}
