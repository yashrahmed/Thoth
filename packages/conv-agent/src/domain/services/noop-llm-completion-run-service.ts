import type { LLMCompletionRunService, RunLlmCompletionInput } from "../contracts/llm-completion-run-service";

/**
 * No-op runner used by the `/append-direct` flow, which persists user messages
 * without ever triggering an LLM completion.
 */
export class NoOpLLMCompletionRunService implements LLMCompletionRunService {
  run(_input: RunLlmCompletionInput): void {
    // intentionally empty
  }
}
