export interface RunLlmCompletionInput {
  readonly conversationId: string;
  readonly parentMessageId: string;
  readonly appendPosition: number;
}

/**
 * Runs an LLM completion that attaches its first reply message at
 * `appendPosition` under `parentMessageId`. The caller declares the target
 * slot up front, so retried or duplicated runs collide on the store's
 * next-child check instead of relocating to a new position. `run` returns
 * immediately; execution is scheduled by the implementation.
 */
export interface LLMCompletionRunService {
  run(input: RunLlmCompletionInput): void;
}
