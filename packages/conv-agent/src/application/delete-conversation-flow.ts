import { type FileDomainService } from "../domain/services/file-domain-service";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import type { DeleteConversationRequest } from "../domain/objects/delete-conversation-request";

export class DeleteConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
  ) {}

  async execute(command: DeleteConversationRequest): Promise<Result<void, NotFoundError | StoreError | ValidationError>> {
    const getResult = await this.conversationDomainService.findById(command.conversationId);

    if (!getResult.ok) {
      return getResult;
    }

    const messagesResult = await this.messageDomainService.findAll(command.conversationId);

    if (!messagesResult.ok) {
      return messagesResult;
    }

    const allFileIds = [...new Set(messagesResult.value.flatMap((message) => message.fileIds))];

    const deleteFilesResult = await this.fileDomainService.deleteFiles({ fileIds: allFileIds });

    if (!deleteFilesResult.ok) {
      return deleteFilesResult;
    }

    const deleteMessagesResult = await this.messageDomainService.deleteAll(command.conversationId);

    if (!deleteMessagesResult.ok) {
      return deleteMessagesResult;
    }

    return this.conversationDomainService.delete(command.conversationId);
  }
}
