import type { ConversationRepository } from "../domain/contracts/conversation-repository";
import { type FileDomainService } from "../domain/services/file-domain-service";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { requireNonEmptyString, requirePositiveInteger } from "./validators";

export interface GetMessagesQuery {
  readonly conversationId: string;
  readonly pageNum: number;
  readonly pageSize: number;
}

export interface GetMessagesItem {
  readonly id: string;
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly files: ReadonlyArray<GetMessagesFile>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GetMessagesFile {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class GetMessagesOnConversationFlow {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
  ) {}

  async execute(
    query: GetMessagesQuery,
  ): Promise<
    Result<GetMessagesItem[], NotFoundError | StoreError | ValidationError>
  > {
    const conversationIdResult = requireNonEmptyString(
      query.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const pageNumResult = requirePositiveInteger(query.pageNum, "pageNum");

    if (!pageNumResult.ok) {
      return pageNumResult;
    }

    const pageSizeResult = requirePositiveInteger(query.pageSize, "pageSize");

    if (!pageSizeResult.ok) {
      return pageSizeResult;
    }

    const conversationResult = await this.conversationRepository.getById(
      conversationIdResult.value,
    );

    if (!conversationResult.ok) {
      return conversationResult;
    }

    const result = await this.messageDomainService.listPageByConversation({
      conversationId: conversationIdResult.value,
      fromSequence: (pageNumResult.value - 1) * pageSizeResult.value + 1,
      limit: pageSizeResult.value,
    });

    if (!result.ok) {
      return result;
    }

    const items: GetMessagesItem[] = [];

    for (const message of result.value) {
      const filesResult = await this.fileDomainService.getFiles({
        fileIds: message.fileIds,
      });

      if (!filesResult.ok) {
        return filesResult;
      }

      items.push({
        id: message.id,
        conversationId: message.conversationId,
        sequenceNumber: message.sequenceNumber,
        textContent: message.textContent,
        files: filesResult.value.map((file) => ({
          id: file.id,
          canonicalUrl: file.canonicalUrl,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeInBytes: file.sizeInBytes,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
        })),
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      });
    }

    return {
      ok: true,
      value: items,
    };
  }
}
