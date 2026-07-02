import type { BlobDomainService } from "../domain/services/blob-domain-service";
import type { DeleteConversationDomainService } from "../domain/services/delete-conversation-domain-service";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { success, traverseAsync } from "../domain/objects/result";
import type { DeleteConversationRequest } from "../domain/objects/request-types";

export class DeleteConversationFlow {
  constructor(
    private readonly deleteConversationDomainService: DeleteConversationDomainService,
    private readonly blobDomainService: BlobDomainService,
  ) {}

  async execute(command: DeleteConversationRequest): Promise<Result<void, NotFoundError | StoreError | ValidationError>> {
    const deleteResult = await this.deleteConversationDomainService.deleteConversation(command.conversationId);

    if (!deleteResult.ok) {
      return deleteResult;
    }

    const blobDeleteResult = await traverseAsync(deleteResult.value.canonicalUrls, (canonicalUrl) => this.blobDomainService.delete(canonicalUrl));

    return blobDeleteResult.ok ? success(undefined) : blobDeleteResult;
  }
}
