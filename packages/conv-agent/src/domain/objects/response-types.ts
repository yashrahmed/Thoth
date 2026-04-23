import type { Conversation } from "./conversation";
import type { LLMMessageType } from "./llm";
import type { File, MessageWithFiles } from "./message-types";

export class ConversationResponse {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(id: string, createdAt: string, updatedAt: string) {
    this.id = id;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static fromConversation(conversation: Conversation): ConversationResponse {
    return new ConversationResponse(conversation.id, conversation.createdAt.toISOString(), conversation.updatedAt.toISOString());
  }
}

class FileResponse {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(id: string, canonicalUrl: string, filename: string, mimeType: string, sizeInBytes: number, createdAt: string, updatedAt: string) {
    this.id = id;
    this.canonicalUrl = canonicalUrl;
    this.filename = filename;
    this.mimeType = mimeType;
    this.sizeInBytes = sizeInBytes;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static fromFile(file: File): FileResponse {
    return new FileResponse(file.id, file.canonicalUrl, file.filename, file.mimeType, file.sizeInBytes, file.createdAt.toISOString(), file.updatedAt.toISOString());
  }
}

export class MessageResponse {
  readonly id: string;
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: string;
  readonly files: ReadonlyArray<FileResponse>;
  readonly createdAt: string;
  readonly updatedAt: string;

  constructor(
    id: string,
    conversationId: string,
    type: LLMMessageType,
    sequenceNumber: number,
    content: string,
    files: ReadonlyArray<FileResponse>,
    createdAt: string,
    updatedAt: string,
  ) {
    this.id = id;
    this.conversationId = conversationId;
    this.type = type;
    this.sequenceNumber = sequenceNumber;
    this.content = content;
    this.files = files;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static fromMessageWithFiles(message: MessageWithFiles): MessageResponse {
    return new MessageResponse(
      message.id,
      message.conversationId,
      message.type,
      message.sequenceNumber,
      message.content,
      message.files.map(FileResponse.fromFile),
      message.createdAt.toISOString(),
      message.updatedAt.toISOString(),
    );
  }
}

export class PageResponse<T> {
  readonly items: ReadonlyArray<T>;
  readonly pageNum: number;
  readonly pageSize: number;

  constructor(items: ReadonlyArray<T>, pageNum: number, pageSize: number) {
    this.items = items;
    this.pageNum = pageNum;
    this.pageSize = pageSize;
  }
}
