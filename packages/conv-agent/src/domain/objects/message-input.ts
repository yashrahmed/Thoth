import type { LLMMessageType } from "./llm";
import type { MessagePart } from "./message";

export class CreateNextMessageInput {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly content: ReadonlyArray<MessagePart>;

  constructor(props: {
    readonly conversationId: string;
    readonly type: LLMMessageType;
    readonly content: ReadonlyArray<MessagePart>;
  }) {
    this.conversationId = props.conversationId;
    this.type = props.type;
    this.content = props.content;
  }
}
