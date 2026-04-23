import type { StoreError } from "../objects/errors";
import type { File } from "../objects/message-types";
import type { Result } from "../objects/result";

export interface CreateSignedUrlOptions {
  readonly expiry_time_sec?: number;
}

export interface FileSignedUrlGenerator {
  createSignedUrl(file: File, options?: CreateSignedUrlOptions): Promise<Result<string, StoreError>>;
}
