import type { LlmCompletionService } from "../contracts/llm-completion-service";
import type { LlmError } from "../objects/errors";
import type { LlmCompletionResult } from "../objects/llm";
import type { Message } from "../objects/message";
import type { Result } from "../objects/result";

export class LlmDomainService {
  constructor(private readonly llmCompletionService: LlmCompletionService) {}

  async sendToLLMChatService(messages: ReadonlyArray<Message>): Promise<Result<LlmCompletionResult, LlmError>> {
    return this.llmCompletionService.complete(messages);
  }
}
