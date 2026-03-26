import type { FileContent } from "../objects/file";
import type { StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface BlobUploadRequest {
  readonly conversationId: string;
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
}

export interface BlobRepository {
  putBlob(request: BlobUploadRequest): Promise<Result<string, StoreError>>;
  removeBlob(url: string): Promise<Result<void, StoreError>>;
}
