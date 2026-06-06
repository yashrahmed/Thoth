import type { LLMMessageType } from "./llm";

export class Attachment {
  readonly content: ArrayBuffer;
  readonly filename: string;
  readonly mimeType: string;

  constructor(content: ArrayBuffer, filename: string, mimeType: string) {
    this.content = content;
    this.filename = filename;
    this.mimeType = mimeType;
  }
}

export class AppendMessageRequest {
  readonly conversationId: string;
  readonly parentMessageId: string | null;
  readonly appendPosition: number;
  readonly type: LLMMessageType;
  readonly content: string;
  readonly attachments: ReadonlyArray<Attachment>;

  constructor(conversationId: string, parentMessageId: string | null, appendPosition: number, type: LLMMessageType, content: string, attachments: ReadonlyArray<Attachment>) {
    this.conversationId = conversationId;
    this.parentMessageId = parentMessageId;
    this.appendPosition = appendPosition;
    this.type = type;
    this.content = content;
    this.attachments = attachments;
  }
}

export class DeleteConversationRequest {
  readonly conversationId: string;

  constructor(conversationId: string) {
    this.conversationId = conversationId;
  }
}

export class GetConversationRequest {
  readonly conversationId: string;

  constructor(conversationId: string) {
    this.conversationId = conversationId;
  }
}

export class UpdateConversationRequest {
  readonly conversationId: string;
  readonly title: string | null;

  constructor(conversationId: string, title: string | null) {
    this.conversationId = conversationId;
    this.title = title;
  }
}
