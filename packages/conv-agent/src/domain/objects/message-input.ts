import type { LLMMessageType } from "./llm";
import type { MessagePart } from "./message";

export class CreateMessageInput {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<MessagePart>;

  constructor(props: {
    readonly conversationId: string;
    readonly type: LLMMessageType;
    readonly sequenceNumber: number;
    readonly content: ReadonlyArray<MessagePart>;
  }) {
    this.conversationId = props.conversationId;
    this.type = props.type;
    this.sequenceNumber = props.sequenceNumber;
    this.content = props.content;
  }
}

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
