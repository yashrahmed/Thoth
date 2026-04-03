import { DeleteMessageCommand, ReceiveMessageCommand, type Message as SqsMessage, type SQSClient } from "@aws-sdk/client-sqs";
import { CompleteConversationFlow } from "../../application/complete-conversation-flow";
import { LlmError, NotFoundError, StoreError, ValidationError } from "../../domain/objects/errors";

const RECEIVE_WAIT_TIME_SECONDS = 1;

export class SqsLlmCompletionListener {
  private stopped = false;
  private loopPromise: Promise<void> | undefined;

  constructor(
    private readonly sqsClient: Pick<SQSClient, "send">,
    private readonly queueUrl: string,
    private readonly completeConversationFlow: CompleteConversationFlow,
  ) {}

  start(): void {
    if (this.loopPromise) {
      return;
    }

    this.loopPromise = this.runLoop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.loopPromise;
  }

  private async runLoop(): Promise<void> {
    while (!this.stopped) {
      try {
        const response = await this.sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: RECEIVE_WAIT_TIME_SECONDS,
          }),
        );

        for (const message of response.Messages ?? []) {
          if (this.stopped) {
            return;
          }

          await this.handleMessage(message);
        }
      } catch (error) {
        if (this.stopped) {
          return;
        }

        console.error("[conv-agent] SQS completion listener failed while polling", error);
      }
    }
  }

  private async handleMessage(message: SqsMessage): Promise<void> {
    const messageId = parseMessageId(message.Body);

    if (!messageId) {
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    const result = await this.completeConversationFlow.execute({ messageId });

    if (result.ok) {
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    if (isTerminalCompletionError(result.error)) {
      console.warn("[conv-agent] SQS completion listener skipped terminal message", {
        messageId,
        reason: getErrorMessage(result.error),
      });
      await this.deleteMessage(message.ReceiptHandle);
      return;
    }

    console.error("[conv-agent] SQS completion listener leaving message for retry", {
      messageId,
      reason: getErrorMessage(result.error),
    });
  }

  private async deleteMessage(receiptHandle: string | undefined): Promise<void> {
    if (!receiptHandle) {
      return;
    }

    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }
}

function parseMessageId(body: string | undefined): string | null {
  if (!body) {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as { readonly messageId?: unknown };
    return typeof parsed.messageId === "string" && parsed.messageId.length > 0 ? parsed.messageId : null;
  } catch {
    return null;
  }
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
