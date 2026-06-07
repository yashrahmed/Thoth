import type { AppendMessageRecord, Message, MessageWithFiles, UploadedFileMetadata } from "../objects/message-types";
import type { StoreError, ValidationError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface PersistUserMessageWithFilesInput {
  readonly message: AppendMessageRecord;
  readonly parentMessageId: string | null;
  readonly appendPosition: number;
  readonly files: ReadonlyArray<UploadedFileMetadata>;
}

export interface PersistMessagesInput {
  readonly messages: ReadonlyArray<AppendMessageRecord>;
  readonly parentMessageId: string;
  readonly appendPosition?: number;
}

export interface AppendUserMessageStore {
  persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<MessageWithFiles, ValidationError | StoreError>>;
  persistMessages(input: PersistMessagesInput): Promise<Result<Message[], ValidationError | StoreError>>;
}
