import type { DispatchLlmCompletionInput, LLMCompletionDispatcher } from "../../domain/contracts/llm-completion-dispatcher";
import type { StoreError } from "../../domain/objects/errors";
import { success, type Result } from "../../domain/objects/result";

export class NoOpLlmCompletionDispatcher implements LLMCompletionDispatcher {
  async dispatch(_input: DispatchLlmCompletionInput): Promise<Result<void, StoreError>> {
    return success(undefined);
  }
}
