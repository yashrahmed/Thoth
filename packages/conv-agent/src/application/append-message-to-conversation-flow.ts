import type { FileContent } from "../domain/objects/file";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import { type FileDomainService } from "../domain/services/file-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type {
  BlobStoreError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import type { ContentPart, ToolCall } from "../domain/objects/message-content";
import type { MessageType } from "../domain/objects/message";

export interface Attachment {
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
}

export interface AppendMessageRequest {
  readonly conversationId: string;
  readonly type: MessageType;
  readonly content: ReadonlyArray<ContentPart>;
  readonly toolCalls: ReadonlyArray<ToolCall>;
  readonly toolCallId: string;
  readonly attachments: ReadonlyArray<Attachment>;
}

export interface AppendMessageResult {
  readonly id: string;
  readonly conversationId: string;
  readonly type: MessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<ContentPart>;
  readonly toolCalls: ReadonlyArray<ToolCall>;
  readonly toolCallId: string;
  readonly fileIds: ReadonlyArray<string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class AppendMessageToConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
  ) {}

  async execute(
    request: AppendMessageRequest,
  ): Promise<
    Result<
      AppendMessageResult,
      | ValidationError
      | NotFoundError
      | StoreError
      | BlobStoreError
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

    const result = await this.messageDomainService.createNextMessage({
      conversationId: request.conversationId,
      type: request.type,
      content: request.content,
      toolCalls: request.toolCalls,
      toolCallId: request.toolCallId,
      fileIds: uploadFilesResult.value.map((file) => file.id),
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      value: {
        id: result.value.id,
        conversationId: result.value.conversationId,
        type: result.value.type,
        sequenceNumber: result.value.sequenceNumber,
        content: result.value.content,
        toolCalls: result.value.toolCalls,
        toolCallId: result.value.toolCallId,
        fileIds: [...result.value.fileIds],
        createdAt: result.value.createdAt,
        updatedAt: result.value.updatedAt,
      },
    };
  }
}
