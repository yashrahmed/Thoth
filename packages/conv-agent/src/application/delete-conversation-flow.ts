import { type FileDomainService } from "../domain/services/file-domain-service";
import { type MessageDomainService } from "../domain/services/message-domain-service";
import type { MessageContentDomainService } from "../domain/services/message-content-domain-service";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { BlobStoreError, NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";

interface DeleteConversationCommand {
  readonly conversationId: string;
}

export class DeleteConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly messageContentDomainService: MessageContentDomainService,
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

    const allFileIds = [
      ...new Set(messagesResult.value.flatMap((m) => this.messageContentDomainService.collectBlobPartFileIds(m.content))),
    ];

    const deleteFilesResult = await this.fileDomainService.deleteFiles({ fileIds: allFileIds });

    if (!deleteFilesResult.ok) {
      return deleteFilesResult;
    }

    const deleteMessagesResult = await this.messageDomainService.removeAllMessagesFromMessageDBStore(command.conversationId);

    if (!deleteMessagesResult.ok) {
      return deleteMessagesResult;
    }

    return this.conversationDomainService.removeFromConversationDBStore(command.conversationId);
  }
}
