import type { BlobRepository } from "../contracts/blob-repository";
import type { StoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";
import { GenericValidationService } from "./generic-validation-service";

export class BlobDomainService {
  constructor(
    private readonly blobRepository: BlobRepository,
    private readonly genericValidationService: GenericValidationService,
  ) {}

  upload(request: { readonly content: ArrayBuffer; readonly filename: string; readonly mimeType: string }): Promise<Result<string, ValidationError | StoreError>> {
    return this.blobRepository.putBlob(request);
  }

  async delete(url: string): Promise<Result<void, ValidationError | StoreError>> {
    const urlResult = this.genericValidationService.requireNonEmptyString(url, "canonicalUrl");

    if (!urlResult.ok) {
      return urlResult;
    }

    return this.blobRepository.removeBlob(urlResult.value);
  }
}
