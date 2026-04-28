import type { InsertNextMessageRecord, Message, UploadedFileMetadata } from "../objects/message-types";
import type { StoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface PersistUserMessageWithFilesInput {
  readonly message: InsertNextMessageRecord;
  readonly files: ReadonlyArray<UploadedFileMetadata>;
}

export interface PersistMessagesInput {
  readonly messages: ReadonlyArray<InsertNextMessageRecord>;
}

export interface AppendUserMessageStore {
  persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<Message, ValidationError | StoreError>>;
  persistMessages(input: PersistMessagesInput): Promise<Result<Message[], ValidationError | StoreError>>;
}
