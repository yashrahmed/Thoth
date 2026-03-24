export enum LLMMessageType {
  User = "user",
  Assistant = "assistant",
  System = "system",
  Tool = "tool",
}

export const LLM_MESSAGE_TYPES = Object.values(LLMMessageType);

export interface LlmCompletionResult {
  readonly content: string;
}
