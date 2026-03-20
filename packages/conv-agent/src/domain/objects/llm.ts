import type { ContentPart, ToolCall } from "./message-content";

export enum LLMMessageType {
  User = "user",
  Assistant = "assistant",
  System = "system",
  Tool = "tool",
}

export const LLM_MESSAGE_TYPES = Object.values(LLMMessageType);

export interface LlmCompletionResult {
  readonly content: ReadonlyArray<ContentPart>;
  readonly toolCalls: ReadonlyArray<ToolCall>;
}
