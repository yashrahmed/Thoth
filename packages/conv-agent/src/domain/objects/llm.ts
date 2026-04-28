export enum LLMMessageType {
  User = "user",
  Assistant = "assistant",
  System = "system",
  Tool = "tool",
}

export const LLM_MESSAGE_TYPES = Object.values(LLMMessageType);

export type LlmCompletionMessageType = LLMMessageType.Assistant | LLMMessageType.Tool;

export interface LlmCompletionMessage {
  readonly type: LlmCompletionMessageType;
  readonly content: string;
}

export interface LlmCompletionResult {
  readonly messages: ReadonlyArray<LlmCompletionMessage>;
}
