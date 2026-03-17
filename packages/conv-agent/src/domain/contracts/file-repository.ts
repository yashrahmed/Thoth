import type { File } from "../objects/file";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface CreateFileRecord {
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FileRepository {
  persistToFileDBStore(
    record: CreateFileRecord,
  ): Promise<Result<File, StoreError>>;
  readFromFileDBStore(
    id: string,
  ): Promise<Result<File, NotFoundError | StoreError>>;
  removeFromFileDBStore(
    id: string,
  ): Promise<Result<void, StoreError>>;
}
