import type { FileContent } from "../domain/contracts/blob-repository";
import type { ConversationRepository } from "../domain/contracts/conversation-repository";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import { type FileDomainService } from "../domain/services/file-domain-service";
import type {
  BlobStoreError,
  ConstructionError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { requireNonEmptyString, requirePresent } from "./validators";

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
    private readonly conversationRepository: ConversationRepository,
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
      | ConstructionError
    >
  > {
    const conversationIdResult = requireNonEmptyString(
      request.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const textContentResult = requirePresent(request.textContent, "textContent");

    if (!textContentResult.ok) {
      return textContentResult;
    }

    const conversationResult = await this.conversationRepository.getById(
      conversationIdResult.value,
    );

    if (!conversationResult.ok) {
      return conversationResult;
    }

    const uploadFilesResult = await this.fileDomainService.uploadFiles({
      files: request.attachments,
    });

    if (!uploadFilesResult.ok) {
      return uploadFilesResult;
    }

    const result = await this.messageDomainService.createNextMessage({
      conversationId: conversationIdResult.value,
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
