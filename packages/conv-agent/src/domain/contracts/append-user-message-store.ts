import type { AppendMessageRecord, MessageWithFiles, UploadedFileMetadata } from "../objects/message-types";
import type { StoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface PersistUserMessageWithFilesInput {
  readonly message: AppendMessageRecord;
  readonly files: ReadonlyArray<UploadedFileMetadata>;
}

export interface AppendUserMessageStore {
  persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<MessageWithFiles, ValidationError | StoreError>>;
}
