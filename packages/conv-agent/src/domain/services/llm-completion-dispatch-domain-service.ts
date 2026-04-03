import type { DispatchLlmCompletionInput, LLMCompletionDispatcher } from "../contracts/llm-completion-dispatcher";
import type { StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export class LlmCompletionDispatchDomainService {
  constructor(private readonly llmCompletionDispatcher: LLMCompletionDispatcher) {}

  async dispatchCompletion(input: DispatchLlmCompletionInput): Promise<Result<void, StoreError>> {
    return this.llmCompletionDispatcher.dispatch(input);
  }
}
