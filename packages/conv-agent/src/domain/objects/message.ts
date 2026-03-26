import type { LLMMessageType } from "./llm";
import type { File } from "./file";

export type MessageWithFiles = Message & { readonly files: ReadonlyArray<File> };

export class Message {
  readonly id: string;
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: string;
  readonly fileIds: ReadonlyArray<string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(id: string, conversationId: string, type: LLMMessageType, sequenceNumber: number, content: string, fileIds: ReadonlyArray<string>, createdAt: Date, updatedAt: Date) {
    this.id = id;
    this.conversationId = conversationId;
    this.type = type;
    this.sequenceNumber = sequenceNumber;
    this.content = content;
    this.fileIds = fileIds;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

export type CreateMessageInput = Pick<Message, "conversationId" | "type" | "content" | "fileIds">;
