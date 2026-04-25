import type { DispatchLlmCompletionInput, LLMCompletionDispatcher } from "../../domain/contracts/llm-completion-dispatcher";
import { EntityType, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, success, type Result } from "../../domain/objects/result";

export interface LlmCompletionQueueMessage {
  readonly messageId: string;
}

export class CloudflareQueueLlmCompletionDispatcher implements LLMCompletionDispatcher {
  constructor(private readonly queue: Queue<LlmCompletionQueueMessage>) {}

  async dispatch(input: DispatchLlmCompletionInput): Promise<Result<void, StoreError>> {
    try {
      await this.queue.send({ messageId: input.messageId });
      return success(undefined);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.Persist, getErrorMessage(error)));
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected Cloudflare queue dispatch error.";
}
