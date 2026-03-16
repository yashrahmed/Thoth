import { type FileDomainService } from "../domain/services/file-domain-service";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type {
  BlobStoreError,
  NotFoundError,
  StoreError,
  ValidationError,
} from "../domain/objects/errors";
import { type Result, success } from "../domain/objects/result";

export interface DeleteConversationCommand {
  readonly conversationId: string;
}

export class DeleteConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
  ) {}

  async execute(
    command: DeleteConversationCommand,
  ): Promise<
    Result<void, NotFoundError | StoreError | ValidationError | BlobStoreError>
  > {
    const getResult = await this.conversationDomainService.getConversation(
      command.conversationId,
    );

    if (!getResult.ok) {
      return getResult;
    }

    const messagesResult = await this.messageDomainService.listMessagesByConversation(
      command.conversationId,
    );

    if (!messagesResult.ok) {
      return messagesResult;
    }

    for (const message of messagesResult.value) {
      const deleteMessageResult = await this.messageDomainService.deleteMessageWithFiles(
        message.id,
        this.fileDomainService,
      );

      if (!deleteMessageResult.ok) {
        return deleteMessageResult;
      }
    }

    const deleteResult = await this.conversationDomainService.deleteConversation(
      command.conversationId,
    );

    if (!deleteResult.ok) {
      return deleteResult;
    }

    return success(undefined);
  }
}
