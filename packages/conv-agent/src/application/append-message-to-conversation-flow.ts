import type { MessageDomainService } from "../domain/services/message-domain-service";
import { type FileDomainService } from "../domain/services/file-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { BlobStoreError, LlmError, NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import { map, type Result } from "../domain/objects/result";
import { LLM_MESSAGE_TYPES, LLMMessageType, type LLMMessageType as LLMMessageTypeValue } from "../domain/objects/llm";
import type { FileContent } from "../domain/objects/file";
import { CreateNextMessageInput } from "../domain/objects/message-input";
import type { MessagePart } from "../domain/objects/message";
import { type LlmDomainService } from "../domain/services/llm-domain-service";
import { UploadFileInput } from "../domain/objects/upload-file-input";
import type { MessageContentDomainService } from "../domain/services/message-content-domain-service";

export const MESSAGE_TYPES = LLM_MESSAGE_TYPES;

export interface Attachment {
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
}

export interface AppendMessageRequest {
  readonly conversationId: string;
  readonly type: LLMMessageTypeValue;
  readonly content: ReadonlyArray<MessagePart>;
  readonly attachments: ReadonlyArray<Attachment>;
}

export class AppendMessageToConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly messageContentDomainService: MessageContentDomainService,
    private readonly fileDomainService: FileDomainService,
    private readonly llmDomainService: LlmDomainService,
  ) {}

  async execute(request: AppendMessageRequest): Promise<Result<void, ValidationError | NotFoundError | StoreError | BlobStoreError | LlmError>> {
    const conversationResult = await this.conversationDomainService.findById(request.conversationId);

    if (!conversationResult.ok) {
      return conversationResult;
    }

    const uploadFilesResult = await this.fileDomainService.uploadFiles({
      files: request.attachments.map(
        (attachment) =>
          new UploadFileInput({
            conversationId: request.conversationId,
            content: attachment.content,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
          }),
      ),
    });

    if (!uploadFilesResult.ok) {
      return uploadFilesResult;
    }

    const userContentResult = this.messageContentDomainService.replaceBlobPartFileIds(
      request.content,
      uploadFilesResult.value.map((file) => file.id),
    );

    if (!userContentResult.ok) {
      return userContentResult;
    }

    const createUserMessageResult = await this.messageDomainService.createNextMessage(
      new CreateNextMessageInput({
        conversationId: request.conversationId,
        type: request.type,
        content: userContentResult.value,
      }),
    );

    if (!createUserMessageResult.ok) {
      return createUserMessageResult;
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
      await this.messageDomainService.createNextMessage(
        new CreateNextMessageInput({
          conversationId: request.conversationId,
          type: LLMMessageType.Assistant,
          content: llmResult.value.content,
        }),
      ),
      () => undefined,
    );
  }
}
