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
  readonly type: LLMMessageType;
  readonly content: string;
  readonly attachments: ReadonlyArray<Attachment>;

  constructor(conversationId: string, type: LLMMessageType, content: string, attachments: ReadonlyArray<Attachment>) {
    this.conversationId = conversationId;
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
  readonly title: string;

  constructor(conversationId: string, title: string) {
    this.conversationId = conversationId;
    this.title = title;
  }
}
