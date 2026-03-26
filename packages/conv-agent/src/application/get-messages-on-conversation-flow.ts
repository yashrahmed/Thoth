import { type FileDomainService } from "../domain/services/file-domain-service";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { MessageWithFiles } from "../domain/objects/message";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { firstFailure, success } from "../domain/objects/result";
import { LLMMessageType } from "../domain/objects/llm";
import { requireNonEmptyString, requirePositiveInteger } from "../domain/validation";

export type { MessageWithFiles };

export class GetMessagesOnConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
  ) {}

  async execute(query: { readonly conversationId: string; readonly pageNum: number; readonly pageSize: number }): Promise<Result<MessageWithFiles[], NotFoundError | StoreError | ValidationError>> {
    const validationResult = firstFailure(
      requireNonEmptyString(query.conversationId, "conversationId"),
      requirePositiveInteger(query.pageNum, "pageNum"),
      requirePositiveInteger(query.pageSize, "pageSize"),
    );

    if (!validationResult.ok) {
      return validationResult;
    }

    const conversationResult = await this.conversationDomainService.findById(query.conversationId);

    if (!conversationResult.ok) {
      return conversationResult;
    }

    const messagesResult = await this.messageDomainService.findPage(query);

    if (!messagesResult.ok) {
      return messagesResult;
    }

    const relevantMessages = messagesResult.value.filter(
      (m) => m.type === LLMMessageType.User || m.type === LLMMessageType.Assistant,
    );

    const allFileIds = [...new Set(relevantMessages.flatMap((message) => message.fileIds))];

    const filesResult = await this.fileDomainService.getFiles({ fileIds: allFileIds });

    if (!filesResult.ok) {
      return filesResult;
    }

    const filesById = new Map(filesResult.value.map((file) => [file.id, file]));

    return success(
      relevantMessages.map((message) => ({
        ...message,
        files: message.fileIds
          .map((id) => filesById.get(id))
          .filter((file): file is NonNullable<typeof file> => file !== undefined),
      })),
    );
  }
}
