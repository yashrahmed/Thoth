import type { LLMMessageType } from "./llm";
import type { Attachment } from "./attachment";

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
