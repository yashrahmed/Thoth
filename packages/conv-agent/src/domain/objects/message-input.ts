import type { LLMMessageType } from "./llm";

export class CreateNextMessageInput {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly content: string;
  readonly fileIds: ReadonlyArray<string>;

  constructor(props: {
    readonly conversationId: string;
    readonly type: LLMMessageType;
    readonly content: string;
    readonly fileIds: ReadonlyArray<string>;
  }) {
    this.conversationId = props.conversationId;
    this.type = props.type;
    this.content = props.content;
    this.fileIds = props.fileIds;
  }
}
