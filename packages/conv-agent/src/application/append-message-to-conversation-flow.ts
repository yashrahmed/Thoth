import type { FileContent } from "../domain/objects/file-content";
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

export interface Attachment {
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
}

export interface AppendMessageRequest {
  readonly conversationId: string;
  readonly textContent: string;
  readonly attachments: ReadonlyArray<Attachment>;
}

export interface AppendMessageResult {
  readonly id: string;
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
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
      textContent: request.textContent,
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
        sequenceNumber: result.value.sequenceNumber,
        textContent: result.value.textContent,
        fileIds: [...result.value.fileIds],
        createdAt: result.value.createdAt,
        updatedAt: result.value.updatedAt,
      },
    };
  }
}
