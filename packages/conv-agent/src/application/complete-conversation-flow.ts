import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import type { LlmDomainService } from "../domain/services/llm-domain-service";
import type { MessageDomainService } from "../domain/services/message-domain-service";
import { LLMMessageType } from "../domain/objects/llm";
import { ValidationError, type LlmError, type NotFoundError, type StoreError } from "../domain/objects/errors";
import { map, type Result } from "../domain/objects/result";

export interface CompleteConversationRequest {
  readonly conversationId: string;
}

export class CompleteConversationFlow {
  constructor(
    private readonly conversationDomainService: ConversationDomainService,
    private readonly messageDomainService: MessageDomainService,
    private readonly llmDomainService: LlmDomainService,
  ) {}

  async execute(request: CompleteConversationRequest): Promise<Result<void, ValidationError | NotFoundError | StoreError | LlmError>> {
    const conversationResult = await this.conversationDomainService.findById(request.conversationId);

    if (!conversationResult.ok) {
      return conversationResult;
    }

    const allMessagesResult = await this.messageDomainService.findAll(request.conversationId);

    if (!allMessagesResult.ok) {
      return allMessagesResult;
    }

    const latestMessage = allMessagesResult.value.at(-1);

    if (!latestMessage) {
      return {
        ok: false,
        error: new ValidationError("conversationId", "conversation must contain at least one message before requesting completion."),
      };
    }

    if (latestMessage.type === LLMMessageType.Assistant) {
      return {
        ok: false,
        error: new ValidationError("conversationId", "conversation cannot be completed when the latest message is already assistant."),
      };
    }

    const llmResult = await this.llmDomainService.complete(allMessagesResult.value);

    if (!llmResult.ok) {
      return llmResult;
    }

    return map(
      await this.messageDomainService.createNextMessage({
        conversationId: request.conversationId,
        type: LLMMessageType.Assistant,
        content: llmResult.value.content,
      }),
      () => undefined,
    );
  }
}
