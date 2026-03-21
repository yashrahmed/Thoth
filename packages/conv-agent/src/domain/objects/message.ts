import type { LLMMessageType } from "./llm";
import type { MessagePart } from "./message-content";

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<MessagePart>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
