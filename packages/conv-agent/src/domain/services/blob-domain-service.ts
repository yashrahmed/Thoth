import type { BlobRepository } from "../contracts/blob-repository";
import type { StoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";
import { andThenAsync } from "../objects/result";
import { requireNonEmptyString } from "../validation";

export class BlobDomainService {
  constructor(private readonly blobRepository: BlobRepository) {}

  async upload(request: {
    readonly conversationId: string;
    readonly content: ArrayBuffer;
    readonly filename: string;
    readonly mimeType: string;
  }): Promise<Result<string, ValidationError | StoreError>> {
    return this.blobRepository.putBlob(request);
  }

  async delete(url: string): Promise<Result<void, ValidationError | StoreError>> {
    return andThenAsync(requireNonEmptyString(url, "canonicalUrl"), () => this.blobRepository.removeBlob(url));
  }
}
