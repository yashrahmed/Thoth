export enum LLMMessageType {
  User = "user",
  Assistant = "assistant",
  System = "system",
  Tool = "tool",
}

export const LLM_MESSAGE_TYPES = Object.values(LLMMessageType);

export enum LlmModel {
  OpenAiGpt54 = "gpt-5.4",
  GoogleGemini3FlashPreview = "gemini-3-flash-preview",
}

export const LLM_MODELS = Object.values(LlmModel);

export function isLlmModel(value: string): value is LlmModel {
  return LLM_MODELS.includes(value as LlmModel);
}

export interface LlmCompletionInputFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly signedUrl: string;
}

export interface LlmCompletionInputMessage {
  readonly type: LLMMessageType;
  readonly content: string;
  readonly files: ReadonlyArray<LlmCompletionInputFile>;
}

export type LlmToolInputSchema = Readonly<Record<string, unknown>>;

export interface LlmToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: LlmToolInputSchema;
}

export interface LlmToolCall {
  readonly id: string;
  readonly name: string;
  readonly inputs: Readonly<Record<string, unknown>>;
}

export interface LlmCompletionMessage {
  readonly type: LLMMessageType.Assistant | LLMMessageType.Tool;
  readonly content: string;
  readonly toolCalls?: ReadonlyArray<LlmToolCall>;
  readonly toolCallId?: string;
  readonly toolName?: string;
  /** Provider-owned continuation data. It is transient and never leaves the completion boundary. */
  readonly providerContext?: unknown;
}
