import type { BlobRepository } from "../contracts/blob-repository";
import type { BlobStoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";
import { requireNonEmptyString } from "../validation";
import { UploadFileInput } from "../objects/upload-file-input";

export class BlobDomainService {
  constructor(private readonly blobRepository: BlobRepository) {}

  async uploadToBlobStore(request: UploadFileInput): Promise<Result<string, ValidationError | BlobStoreError>> {
    return this.blobRepository.putBlob(request);
  }

  async deleteFromBlobStore(url: string): Promise<Result<void, ValidationError | BlobStoreError>> {
    const canonicalUrlResult = requireNonEmptyString(url, "canonicalUrl");

    if (!canonicalUrlResult.ok) {
      return canonicalUrlResult;
    }

    return this.blobRepository.removeBlob(url);
  }
}
