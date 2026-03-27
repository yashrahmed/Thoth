import type { StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface BlobRepository {
  putBlob(request: { readonly content: ArrayBuffer; readonly filename: string; readonly mimeType: string }): Promise<Result<string, StoreError>>;
  removeBlob(url: string): Promise<Result<void, StoreError>>;
}
