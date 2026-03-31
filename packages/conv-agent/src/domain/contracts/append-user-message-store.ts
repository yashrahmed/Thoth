import type { UploadedFileMetadata } from "../objects/file";
import type { LLMMessageType } from "../objects/llm";
import type { Message } from "../objects/message";
import type { StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface PersistUserMessageWithFilesInput {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly content: string;
  readonly files: ReadonlyArray<UploadedFileMetadata>;
}

export interface AppendUserMessageStore {
  persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<Message, StoreError>>;
}
