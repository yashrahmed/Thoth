import { type FileDomainService } from "../domain/services/file-domain-service";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import type { MessageContentDomainService } from "../domain/services/message-content-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { firstFailure, map, success } from "../domain/objects/result";
import { LLMMessageType, type LLMMessageType as MessageType } from "../domain/objects/llm";
import type { MessagePart } from "../domain/objects/message";
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
    return firstFailure(
      requireNonEmptyString(this.conversationId, "conversationId"),
      requirePositiveInteger(this.pageNum, "pageNum"),
      requirePositiveInteger(this.pageSize, "pageSize"),
    );
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
    private readonly messageContentDomainService: MessageContentDomainService,
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

    const messagesResult = await this.messageDomainService.readPageFromMessageDBStore({
      conversationId: query.conversationId,
      pageNum: query.pageNum,
      pageSize: query.pageSize,
    });

    if (!messagesResult.ok) {
      return messagesResult;
    }

    const relevantMessages = messagesResult.value.filter(
      (m) => m.type === LLMMessageType.User || m.type === LLMMessageType.Assistant,
    );

    const allFileIds = [
      ...new Set(relevantMessages.flatMap((m) => this.messageContentDomainService.collectBlobPartFileIds(m.content))),
    ];

    const filesResult = await this.fileDomainService.getFiles({ fileIds: allFileIds });

    if (!filesResult.ok) {
      return filesResult;
    }

    const filesById = new Map(filesResult.value.map((file) => [file.id, file]));

    return success(
      relevantMessages.map((message) => {
        const messageFileIds = this.messageContentDomainService.collectBlobPartFileIds(message.content);

        return {
          id: message.id,
          conversationId: message.conversationId,
          type: message.type,
          sequenceNumber: message.sequenceNumber,
          content: message.content,
          files: messageFileIds
            .map((id) => filesById.get(id))
            .filter((file): file is NonNullable<typeof file> => file !== undefined)
            .map((file) => ({
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
        };
      }),
    );
  }
}
