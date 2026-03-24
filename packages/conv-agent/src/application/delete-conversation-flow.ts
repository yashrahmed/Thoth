import { type FileDomainService } from "../domain/services/file-domain-service";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { BlobStoreError, NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { andThenAsync, traverseAsync } from "../domain/objects/result";

interface DeleteConversationCommand {
  readonly conversationId: string;
}

export class DeleteConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
  ) {}

  async execute(command: DeleteConversationCommand): Promise<Result<void, NotFoundError | StoreError | ValidationError | BlobStoreError>> {
    const getResult = await this.conversationDomainService.readFromConversationDBStore(command.conversationId);

    if (!getResult.ok) {
      return getResult;
    }

    const messagesResult = await this.messageDomainService.readAllMessagesFromMessageDBStore(command.conversationId);

    if (!messagesResult.ok) {
      return messagesResult;
    }

    return andThenAsync(
      await traverseAsync(messagesResult.value, (message) =>
        this.messageDomainService.deleteMessageWithFiles(message.id, this.fileDomainService),
      ),
      () => this.conversationDomainService.removeFromConversationDBStore(command.conversationId),
    );
  }
}
