import { type FileDomainService } from "../domain/services/file-domain-service";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { MessageWithFiles } from "../domain/objects/message";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { firstFailure, success } from "../domain/objects/result";
import { LLMMessageType } from "../domain/objects/llm";
import { GenericValidationService } from "../domain/services/generic-validation-service";

export type { MessageWithFiles };

export class GetMessagesOnConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
    private readonly genericValidationService: GenericValidationService,
  ) {}

  async execute(query: {
    readonly conversationId: string;
    readonly pageNum: number;
    readonly pageSize: number;
  }): Promise<Result<MessageWithFiles[], NotFoundError | StoreError | ValidationError>> {
    const validationResult = firstFailure(
      this.genericValidationService.requireNonEmptyString(query.conversationId, "conversationId"),
      this.genericValidationService.requirePositiveInteger(query.pageNum, "pageNum"),
      this.genericValidationService.requirePositiveInteger(query.pageSize, "pageSize"),
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

    const relevantMessages = messagesResult.value.filter((m) => m.type === LLMMessageType.User || m.type === LLMMessageType.Assistant);
    const filesResult = await this.fileDomainService.getFilesOnMessages({
      messageIds: relevantMessages.map((message) => message.id),
    });

    if (!filesResult.ok) {
      return filesResult;
    }

    const filesByMessageId = new Map<string, typeof filesResult.value>();

    for (const file of filesResult.value) {
      const existingFiles = filesByMessageId.get(file.messageId) ?? [];
      filesByMessageId.set(file.messageId, [...existingFiles, file]);
    }

    return success(
      relevantMessages.map((message) => ({
        ...message,
        files: filesByMessageId.get(message.id) ?? [],
      })),
    );
  }
}
