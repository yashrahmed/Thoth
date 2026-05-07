import type { LlmCompletionResult } from "../objects/llm";
import type { LlmError } from "../objects/errors";
import type { MessageWithFiles } from "../objects/message-types";
import type { Result } from "../objects/result";

export interface LlmCompletionService {
  llmComplete(messages: ReadonlyArray<MessageWithFiles>): Promise<Result<LlmCompletionResult, LlmError>>;
}
