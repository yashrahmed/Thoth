import type { BlobStoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export type FileContent = ArrayBuffer;

export interface BlobUploadRequest {
  readonly conversationId: string;
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
}

export interface BlobRepository {
  uploadToBlobStore(
    request: BlobUploadRequest,
  ): Promise<Result<string, BlobStoreError>>;
  deleteFromBlobStore(
    url: string,
  ): Promise<Result<void, BlobStoreError>>;
}
