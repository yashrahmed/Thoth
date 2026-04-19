import type { BlobDomainService } from "../domain/services/blob-domain-service";
import type { DeleteConversationGraphDomainService } from "../domain/services/delete-conversation-graph-domain-service";
import type { NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import type { Result } from "../domain/objects/result";
import { success, traverseAsync } from "../domain/objects/result";
import type { DeleteConversationRequest } from "../domain/objects/request-types";

export class DeleteConversationFlow {
  constructor(
    private readonly deleteConversationGraphDomainService: DeleteConversationGraphDomainService,
    private readonly blobDomainService: BlobDomainService,
  ) {}

  async execute(command: DeleteConversationRequest): Promise<Result<void, NotFoundError | StoreError | ValidationError>> {
    const deleteGraphResult = await this.deleteConversationGraphDomainService.deleteConversationGraph(command.conversationId);

    if (!deleteGraphResult.ok) {
      return deleteGraphResult;
    }

    const blobDeleteResult = await traverseAsync(deleteGraphResult.value.canonicalUrls, (canonicalUrl) => this.blobDomainService.delete(canonicalUrl));

    return blobDeleteResult.ok ? success(undefined) : blobDeleteResult;
  }
}
