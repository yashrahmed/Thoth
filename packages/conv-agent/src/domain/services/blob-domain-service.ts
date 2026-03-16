import type {
  BlobRepository,
  BlobUploadRequest,
} from "../contracts/blob-repository";
import type { BlobStoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";
import { requireNonEmptyString, requirePresent } from "../validation";

export class BlobDomainService {
  constructor(private readonly blobRepository: BlobRepository) {}

  async uploadBlob(
    request: BlobUploadRequest,
  ): Promise<Result<string, ValidationError | BlobStoreError>> {
    const contentResult = requirePresent(request.content, "content");

    if (!contentResult.ok) {
      return contentResult;
    }

    const conversationIdResult = requireNonEmptyString(
      request.conversationId,
      "conversationId",
    );

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const filenameResult = requireNonEmptyString(request.filename, "filename");

    if (!filenameResult.ok) {
      return filenameResult;
    }

    const mimeTypeResult = requireNonEmptyString(request.mimeType, "mimeType");

    if (!mimeTypeResult.ok) {
      return mimeTypeResult;
    }

    return this.blobRepository.upload(request);
  }

  async deleteBlob(
    canonicalUrl: string,
  ): Promise<Result<void, ValidationError | BlobStoreError>> {
    const canonicalUrlResult = requireNonEmptyString(
      canonicalUrl,
      "canonicalUrl",
    );

    if (!canonicalUrlResult.ok) {
      return canonicalUrlResult;
    }

    return this.blobRepository.delete(canonicalUrl);
  }
}
