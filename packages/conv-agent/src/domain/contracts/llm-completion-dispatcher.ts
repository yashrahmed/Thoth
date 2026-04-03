import type { StoreError } from "../objects/errors";
import type { Result } from "../objects/result";

export interface DispatchLlmCompletionInput {
  readonly messageId: string;
}

export interface LLMCompletionDispatcher {
  dispatch(input: DispatchLlmCompletionInput): Promise<Result<void, StoreError>>;
}
