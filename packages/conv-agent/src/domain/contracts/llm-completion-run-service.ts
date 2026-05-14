export interface RunLlmCompletionInput {
  readonly messageId: string;
  readonly conversationId: string;
}

/**
 * Decides what happens with a freshly persisted user message.
 * `AppendMessageToConversationFlow` calls `run` once persistence succeeds and
 * is agnostic to whether the runner kicks off an LLM completion, drops the
 * call, or hands it off elsewhere.
 */
export interface LLMCompletionRunService {
  run(input: RunLlmCompletionInput): void;
}
