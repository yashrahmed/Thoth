import type { AppendUserMessageDomainService } from "../domain/services/append-user-message-domain-service";
import type { LlmDomainService } from "../domain/services/llm-domain-service";
import type { MessageDomainService } from "../domain/services/message-domain-service";
import { LLMMessageType } from "../domain/objects/llm";
import { ValidationError, type LlmError, type NotFoundError, type StoreError } from "../domain/objects/errors";
import { type Result } from "../domain/objects/result";

export interface CompleteConversationRequest {
  readonly messageId: string;
}

export class CompleteConversationFlow {
  constructor(
    private readonly messageDomainService: MessageDomainService,
    private readonly llmDomainService: LlmDomainService,
    private readonly appendUserMessageDomainService: AppendUserMessageDomainService,
  ) {}

  async execute(request: CompleteConversationRequest): Promise<Result<void, ValidationError | NotFoundError | StoreError | LlmError>> {
    const triggerMessageResult = await this.messageDomainService.findById(request.messageId);

    if (!triggerMessageResult.ok) {
      return triggerMessageResult;
    }

    const triggerMessage = triggerMessageResult.value;
    const allMessagesResult = await this.messageDomainService.findAll(triggerMessage.conversationId);

    if (!allMessagesResult.ok) {
      return allMessagesResult;
    }

    const latestMessage = allMessagesResult.value.at(-1);

    if (!latestMessage) {
      return {
        ok: false,
        error: new ValidationError("messageId", "conversation must contain at least one message before requesting completion."),
      };
    }

    if (latestMessage.id !== triggerMessage.id) {
      return {
        ok: false,
        error: new ValidationError("messageId", `messageId must reference the latest message; received ${triggerMessage.id} but latest is ${latestMessage.id}.`),
      };
    }

    if (triggerMessage.type !== LLMMessageType.User) {
      return {
        ok: false,
        error: new ValidationError("messageId", `messageId must reference a user message; received ${triggerMessage.type}.`),
      };
    }

    const llmResult = await this.llmDomainService.complete(allMessagesResult.value);

    if (!llmResult.ok) {
      return llmResult;
    }

    const nextMessageRecordResult = await this.messageDomainService.buildNextMessageRecord({
      conversationId: triggerMessage.conversationId,
      type: LLMMessageType.Assistant,
      content: llmResult.value.content,
    });

    if (!nextMessageRecordResult.ok) {
      return nextMessageRecordResult;
    }

    const appendMessageResult = await this.appendUserMessageDomainService.persistUserMessageWithFiles({
      message: nextMessageRecordResult.value,
      files: [],
    });

    if (!appendMessageResult.ok) {
      return appendMessageResult;
    }

    return { ok: true, value: undefined };
  }
}
