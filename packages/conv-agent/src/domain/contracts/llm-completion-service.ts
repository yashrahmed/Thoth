import type { LlmCompletionResult } from "../objects/llm";
import type { LlmError } from "../objects/errors";
import type { Message } from "../objects/message-types";
import type { Result } from "../objects/result";

export interface LlmCompletionService {
  llmComplete(messages: ReadonlyArray<Message>): Promise<Result<LlmCompletionResult, LlmError>>;
}
