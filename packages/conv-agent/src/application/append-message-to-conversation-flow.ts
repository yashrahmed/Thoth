import type { MessageDomainService } from "../domain/services/message-domain-service";
import { type FileDomainService } from "../domain/services/file-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { LlmError, NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import { map, type Result } from "../domain/objects/result";
import { LLM_MESSAGE_TYPES, LLMMessageType, type LLMMessageType as LLMMessageTypeValue } from "../domain/objects/llm";
import { type LlmDomainService } from "../domain/services/llm-domain-service";

export const MESSAGE_TYPES = LLM_MESSAGE_TYPES;

export interface Attachment {
  readonly content: ArrayBuffer;
  readonly filename: string;
  readonly mimeType: string;
}

export interface AppendMessageRequest {
  readonly conversationId: string;
  readonly type: LLMMessageTypeValue;
  readonly content: string;
  readonly attachments: ReadonlyArray<Attachment>;
}

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

    const uploadFilesResult = await this.fileDomainService.uploadFiles({
      files: request.attachments.map((attachment) => ({
        conversationId: request.conversationId,
        content: attachment.content,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
      })),
    });

    if (!uploadFilesResult.ok) {
      return uploadFilesResult;
    }

    const createUserMessageResult = await this.messageDomainService.createNextMessage({
      conversationId: request.conversationId,
      type: request.type,
      content: request.content,
      fileIds: uploadFilesResult.value.map((file) => file.id),
    });

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
