export enum LLMMessageType {
  User = "user",
  Assistant = "assistant",
  System = "system",
  Tool = "tool",
}

export const LLM_MESSAGE_TYPES = Object.values(LLMMessageType);

export interface LlmCompletionMessage {
  readonly type: LLMMessageType.Assistant | LLMMessageType.Tool;
  readonly content: string;
}

export interface LlmCompletionResult {
  readonly messages: ReadonlyArray<LlmCompletionMessage>;
}
