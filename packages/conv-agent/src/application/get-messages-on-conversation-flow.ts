import type { ConversationRepository } from "../domain/contracts/conversation-repository";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { requireNonEmptyString, requirePositiveInteger } from "./validators";

export interface GetMessagesOnConversationQuery {
  readonly conversationId: string;
  readonly pageNum: number;
  readonly pageSize: number;
}

export interface GetMessagesOnConversationItem {
  readonly id: string;
  readonly conversationId: string;
  readonly sequenceNumber: number;
  readonly textContent: string;
  readonly fileIds: ReadonlyArray<string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class GetMessagesOnConversationFlow {
  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly messageDomainService: MessageDomainService,
  ) {}

  async execute(
    query: GetMessagesOnConversationQuery,
  ): Promise<
    Result<GetMessagesOnConversationItem[], NotFoundError | StoreError | ValidationError>
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

    return {
      ok: true,
      value: result.value.map((message) => ({
        id: message.id,
        conversationId: message.conversationId,
        sequenceNumber: message.sequenceNumber,
        textContent: message.textContent,
        fileIds: [...message.fileIds],
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      })),
    };
  }
}
