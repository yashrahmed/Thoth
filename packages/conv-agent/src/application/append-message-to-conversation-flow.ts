import { type MessageDomainService } from "../domain/services/message-domain-service";
import { type FileDomainService } from "../domain/services/file-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type {
  BlobStoreError,
  LlmError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../domain/objects/errors";
import { success, type Result } from "../domain/objects/result";
import {
  LLM_MESSAGE_TYPES,
  LLMMessageType,
  type LLMMessageType as LLMMessageTypeValue,
} from "../domain/objects/llm";
import type { FileContent } from "../domain/objects/file";
import type { DomainContentPart } from "../domain/objects/content-part-type";
import { type LlmDomainService } from "../domain/services/llm-domain-service";

export const MESSAGE_TYPES = LLM_MESSAGE_TYPES;

export interface Attachment {
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
}

export interface AppendMessageRequest {
  readonly conversationId: string;
  readonly type: LLMMessageTypeValue;
  readonly content: ReadonlyArray<DomainContentPart>;
  readonly attachments: ReadonlyArray<Attachment>;
}

export class AppendMessageToConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
    private readonly llmDomainService: LlmDomainService,
  ) {}

  async execute(
    request: AppendMessageRequest,
  ): Promise<
    Result<
      void,
      ValidationError | NotFoundError | StoreError | BlobStoreError | LlmError
    >
  > {
    const conversationResult = await this.conversationDomainService.readFromConversationDBStore(
      request.conversationId,
    );

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
      toolCalls: [],
      toolCallId: "",
      fileIds: uploadFilesResult.value.map((file) => file.id),
    });

    if (!createUserMessageResult.ok) {
      return createUserMessageResult;
    }

    const allMessagesResult = await this.messageDomainService.readAllMessagesFromMessageDBStore(
      request.conversationId,
    );

    if (!allMessagesResult.ok) {
      return allMessagesResult;
    }

    const llmResult = await this.llmDomainService.sendToLLMChatService(
      allMessagesResult.value,
    );

    if (!llmResult.ok) {
      return llmResult;
    }

    const createAssistantMessageResult = await this.messageDomainService.createNextMessage({
      conversationId: request.conversationId,
      type: LLMMessageType.Assistant,
      content: llmResult.value.content,
      toolCalls: llmResult.value.toolCalls,
      toolCallId: "",
      fileIds: [],
    });

    if (!createAssistantMessageResult.ok) {
      return createAssistantMessageResult;
    }

    return success(undefined);
  }
}
