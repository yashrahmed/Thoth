import type { File } from "../objects/file";
import type { NotFoundError, StoreError, ValidationError } from "../objects/errors";
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
  ): Promise<Result<File, ValidationError | NotFoundError | StoreError>>;
  deleteById(id: string): Promise<Result<void, StoreError>>;
}
