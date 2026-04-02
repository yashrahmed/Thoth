import type { UploadedFileMetadata } from "../objects/file";
import type { InsertNextMessageRecord, Message } from "../objects/message";
import type { StoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface PersistUserMessageWithFilesInput {
  readonly message: InsertNextMessageRecord;
  readonly files: ReadonlyArray<UploadedFileMetadata>;
}

export interface AppendUserMessageStore {
  persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<Message, ValidationError | StoreError>>;
}
