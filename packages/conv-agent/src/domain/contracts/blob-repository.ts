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
  putBlob(
    request: BlobUploadRequest,
  ): Promise<Result<string, BlobStoreError>>;
  removeBlob(
    url: string,
  ): Promise<Result<void, BlobStoreError>>;
}
