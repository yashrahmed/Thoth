import { type FileDomainService } from "../domain/services/file-domain-service";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { LLMMessageType, type LLMMessageType as MessageType } from "../domain/objects/llm";
import { collectBlobPartFileIds, type MessagePart } from "../domain/objects/message-content";
import { requireNonEmptyString, requirePositiveInteger } from "../domain/validation";

export class GetMessagesQuery {
  readonly conversationId: string;
  readonly pageNum: number;
  readonly pageSize: number;

  constructor(props: {
    readonly conversationId: string;
    readonly pageNum: number;
    readonly pageSize: number;
  }) {
    this.conversationId = props.conversationId;
    this.pageNum = props.pageNum;
    this.pageSize = props.pageSize;
  }

  isValid(): Result<void, ValidationError> {
    const conversationIdResult = requireNonEmptyString(this.conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const pageNumResult = requirePositiveInteger(this.pageNum, "pageNum");

    if (!pageNumResult.ok) {
      return pageNumResult;
    }

    const pageSizeResult = requirePositiveInteger(this.pageSize, "pageSize");

    if (!pageSizeResult.ok) {
      return pageSizeResult;
    }

    return {
      ok: true,
      value: undefined,
    };
  }
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

export interface GetMessagesItem {
  readonly id: string;
  readonly conversationId: string;
  readonly type: MessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<MessagePart>;
  readonly files: ReadonlyArray<GetMessagesFile>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class GetMessagesOnConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
  ) {}

  async execute(query: GetMessagesQuery): Promise<Result<GetMessagesItem[], NotFoundError | StoreError | ValidationError>> {
    const validationResult = query.isValid();

    if (!validationResult.ok) {
      return validationResult;
    }

    const conversationResult = await this.conversationDomainService.readFromConversationDBStore(query.conversationId);

    if (!conversationResult.ok) {
      return conversationResult;
    }

    const result = await this.messageDomainService.readPageFromMessageDBStore({
      conversationId: query.conversationId,
      pageNum: query.pageNum,
      pageSize: query.pageSize,
    });

    if (!result.ok) {
      return result;
    }

    const items: GetMessagesItem[] = [];

    for (const message of result.value) {
      if (message.type !== LLMMessageType.User && message.type !== LLMMessageType.Assistant) {
        continue;
      }

      const filesResult = await this.fileDomainService.getFiles({
        fileIds: collectBlobPartFileIds(message.content),
      });

      if (!filesResult.ok) {
        return filesResult;
      }

      items.push({
        id: message.id,
        conversationId: message.conversationId,
        type: message.type,
        sequenceNumber: message.sequenceNumber,
        content: message.content,
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
