import type { LlmCompletionService } from "../contracts/llm-completion-service";
import type { LlmError } from "../objects/errors";
import type { LlmCompletionResult } from "../objects/llm";
import type { MessageWithFiles } from "../objects/message-types";
import type { Result } from "../objects/result";

export class LlmDomainService {
  constructor(private readonly llmCompletionService: LlmCompletionService) {}

  async complete(messages: ReadonlyArray<MessageWithFiles>): Promise<Result<LlmCompletionResult, LlmError>> {
    return this.llmCompletionService.llmComplete(messages);
  }
}
