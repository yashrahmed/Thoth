import { SendMessageCommand, type SQSClient } from "@aws-sdk/client-sqs";
import type { DispatchLlmCompletionInput, LLMCompletionDispatcher } from "../../domain/contracts/llm-completion-dispatcher";
import { EntityType, StoreError, StoreOperation } from "../../domain/objects/errors";
import { failure, success, type Result } from "../../domain/objects/result";

export class SqsLlmCompletionDispatcher implements LLMCompletionDispatcher {
  constructor(
    private readonly sqsClient: Pick<SQSClient, "send">,
    private readonly queueUrl: string,
  ) {}

  async dispatch(input: DispatchLlmCompletionInput): Promise<Result<void, StoreError>> {
    try {
      await this.sqsClient.send(
        new SendMessageCommand({
          QueueUrl: this.queueUrl,
          MessageBody: JSON.stringify({
            messageId: input.messageId,
          }),
        }),
      );

      return success(undefined);
    } catch (error) {
      return failure(new StoreError(EntityType.Message, StoreOperation.Persist, getErrorMessage(error)));
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected SQS dispatch error.";
}
