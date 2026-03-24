import type { LLMMessageType } from "./llm";

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: string;
  readonly fileIds: ReadonlyArray<string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
