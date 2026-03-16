import type { BlobStoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";

export type FileContent = ArrayBuffer;

export interface BlobUploadRequest {
  readonly conversationId: string;
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
}

export interface BlobRepository {
  upload(
    request: BlobUploadRequest,
  ): Promise<Result<string, ValidationError | BlobStoreError>>;
  delete(canonicalUrl: string): Promise<Result<void, BlobStoreError>>;
}
