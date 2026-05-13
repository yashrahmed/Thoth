import type { LlmCompletionInputMessage, LlmCompletionResult } from "../objects/llm";
import type { LlmError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface LlmService {
  llmComplete(messages: ReadonlyArray<LlmCompletionInputMessage>): Promise<Result<LlmCompletionResult, LlmError>>;
}
