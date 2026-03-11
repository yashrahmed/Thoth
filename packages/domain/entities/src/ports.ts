import { Conversation } from "./aggregates/conversation";
import { ConversationId } from "./value-objects";

export interface PutBlobInput {
  objectKey: string;
  body: ArrayBuffer;
  contentType: string;
  byteSize: number;
}

export interface HeadBlobInput {
  objectKey: string;
}

export interface GetBlobInput {
  objectKey: string;
}

export interface DeleteBlobInput {
  objectKey: string;
}

export interface CopyBlobInput {
  sourceObjectKey: string;
  destinationObjectKey: string;
}

export interface StoredBlobMetadata {
  objectKey: string;
  byteSize: number | null;
  contentType: string | null;
  etag: string | null;
  lastModified: Date | null;
}

export interface StoredBlobBody extends StoredBlobMetadata {
  body: ReadableStream<Uint8Array>;
}

export interface BlobStore {
  putObject(input: PutBlobInput): Promise<StoredBlobMetadata>;
  headObject(input: HeadBlobInput): Promise<StoredBlobMetadata | null>;
  getObject(input: GetBlobInput): Promise<StoredBlobBody>;
  deleteObject(input: DeleteBlobInput): Promise<void>;
  copyObject(input: CopyBlobInput): Promise<StoredBlobMetadata>;
}

export interface ConversationRepository {
  getById(conversationId: ConversationId): Promise<Conversation | null>;
  list(): Promise<Conversation[]>;
  save(conversation: Conversation): Promise<void>;
  delete(conversationId: ConversationId): Promise<void>;
}
