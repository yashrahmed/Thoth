import type { File } from "../objects/message-types";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface FileRepository {
  upsertFileRow(record: Omit<File, "id">): Promise<Result<File, StoreError>>;
  selectFileRow(id: string): Promise<Result<File, NotFoundError | StoreError>>;
  selectFileRows(ids: ReadonlyArray<string>): Promise<Result<File[], StoreError>>;
  selectFileRowsByMessageIds(messageIds: ReadonlyArray<string>): Promise<Result<File[], StoreError>>;
  selectFileRowsByConversationId(conversationId: string): Promise<Result<File[], StoreError>>;
  deleteFileRow(id: string): Promise<Result<void, StoreError>>;
  deleteFileRows(ids: ReadonlyArray<string>): Promise<Result<void, StoreError>>;
  deleteFileRowsByMessageIds(messageIds: ReadonlyArray<string>): Promise<Result<void, StoreError>>;
}
