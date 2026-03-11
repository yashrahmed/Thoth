import type { File, FileId, MessageId } from "@thoth/entities";

export interface FileRepository {
  create(file: File, messageId: MessageId): Promise<File>;
  getById(fileId: FileId): Promise<File | null>;
  listByMessageId(messageId: MessageId): Promise<File[]>;
  listByMessageIds(messageIds: MessageId[]): Promise<Map<MessageId, File[]>>;
  getByObjectKey(objectKey: string): Promise<File | null>;
  delete(fileId: FileId): Promise<void>;
}
