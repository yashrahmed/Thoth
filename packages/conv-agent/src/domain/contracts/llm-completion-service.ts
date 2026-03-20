import type { LlmCompletionResult } from "../objects/llm";
import type { LlmError } from "../objects/errors";
import type { Message } from "../objects/message";
import type { Result } from "../objects/result";

export interface LlmCompletionService {
  complete(messages: ReadonlyArray<Message>): Promise<Result<LlmCompletionResult, LlmError>>;
}
