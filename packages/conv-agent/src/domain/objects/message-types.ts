import type { LLMMessageType } from "./llm";

export type MessageWithFiles = Message & { readonly files: ReadonlyArray<File> };

export class Message {
  readonly id: string;
  readonly conversationId: string;
  readonly parentMessageId: string | null;
  readonly childCount: number;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(
    id: string,
    conversationId: string,
    type: LLMMessageType,
    sequenceNumber: number,
    content: string,
    createdAt: Date,
    updatedAt: Date,
    parentMessageId: string | null = null,
    childCount: number = 0,
  ) {
    this.id = id;
    this.conversationId = conversationId;
    this.parentMessageId = parentMessageId;
    this.childCount = childCount;
    this.type = type;
    this.sequenceNumber = sequenceNumber;
    this.content = content;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

export type CreateMessageInput = Pick<Message, "conversationId" | "type" | "content">;

export type CreateMessageContentInput = Pick<Message, "type" | "content">;

export type AppendMessageRecord = Pick<Message, "conversationId" | "type" | "content" | "createdAt" | "updatedAt">;

export class File {
  readonly id: string;
  readonly messageId: string;
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(id: string, messageId: string, canonicalUrl: string, filename: string, mimeType: string, sizeInBytes: number, createdAt: Date, updatedAt: Date) {
    this.id = id;
    this.messageId = messageId;
    this.canonicalUrl = canonicalUrl;
    this.filename = filename;
    this.mimeType = mimeType;
    this.sizeInBytes = sizeInBytes;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

export type UploadedFileMetadata = Pick<File, "canonicalUrl" | "filename" | "mimeType" | "sizeInBytes">;
