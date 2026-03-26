import type { BlobRepository } from "../contracts/blob-repository";
import type { StoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";
import { andThenAsync } from "../objects/result";
import { requireNonEmptyString } from "../validation";
import { UploadFileInput } from "../objects/upload-file-input";

export class BlobDomainService {
  constructor(private readonly blobRepository: BlobRepository) {}

  async upload(request: UploadFileInput): Promise<Result<string, ValidationError | StoreError>> {
    return this.blobRepository.putBlob(request);
  }

  async delete(url: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(requireNonEmptyString(url, "canonicalUrl"), () => this.blobRepository.removeBlob(url));
  }
}
