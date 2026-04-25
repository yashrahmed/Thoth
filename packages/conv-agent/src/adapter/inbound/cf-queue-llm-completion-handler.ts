import { LlmCompletionFlow } from "../../application/llm-completion-flow";
import { LlmError, NotFoundError, StoreError, ValidationError } from "../../domain/objects/errors";
import type { LlmCompletionQueueMessage } from "../queue/cf-queue-llm-completion-dispatcher";

export function createQueueLlmCompletionHandler(
  llmCompletionFlow: LlmCompletionFlow,
): (batch: MessageBatch<LlmCompletionQueueMessage>) => Promise<void> {
  return async (batch) => {
    for (const message of batch.messages) {
      const messageId = message.body?.messageId;

      if (typeof messageId !== "string" || messageId.length === 0) {
        message.ack();
        continue;
      }

      const result = await llmCompletionFlow.execute({ messageId });

      if (result.ok) {
        message.ack();
        continue;
      }

      if (isTerminalCompletionError(result.error)) {
        console.warn("[conv-agent] Queue handler skipped terminal message", {
          messageId,
          reason: getErrorMessage(result.error),
        });
        message.ack();
        continue;
      }

      console.error("[conv-agent] Queue handler retrying message", {
        messageId,
        reason: getErrorMessage(result.error),
      });
      message.retry();
    }
  };
}

function isTerminalCompletionError(error: ValidationError | NotFoundError | StoreError | LlmError): boolean {
  return error instanceof ValidationError || error instanceof NotFoundError;
}

function getErrorMessage(error: ValidationError | NotFoundError | StoreError | LlmError): string {
  if (error instanceof ValidationError || error instanceof StoreError || error instanceof LlmError) {
    return error.message;
  }

  return `${error.entityType} ${error.id} not found`;
}
