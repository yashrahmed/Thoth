import type { AppendUserMessageDomainService } from "../domain/services/append-user-message-domain-service";
import type { FileAccessDomainService, SignedFileAccess } from "../domain/services/file-access-domain-service";
import { type FileDomainService } from "../domain/services/file-domain-service";
import type { LlmPromptDomainService } from "../domain/services/llm-prompt-domain-service";
import type { MessageDomainService } from "../domain/services/message-domain-service";
import { LLMMessageType, type LlmCompletionInputFile, type LlmCompletionInputMessage, type LlmCompletionMessage, type LlmCompletionResult } from "../domain/objects/llm";
import { ValidationError, type LlmError, type NotFoundError, type StoreError } from "../domain/objects/errors";
import { success, type Result } from "../domain/objects/result";
import type { Message } from "../domain/objects/message-types";

interface LlmCompletionRequest {
  readonly messageId: string;
}

interface LlmCompletionPort {
  llmComplete(messages: ReadonlyArray<LlmCompletionInputMessage>): Promise<Result<LlmCompletionResult, LlmError>>;
}

export class LlmCompletionFlow {
  constructor(
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
    private readonly fileAccessDomainService: FileAccessDomainService,
    private readonly llmCompletionService: LlmCompletionPort,
    private readonly appendUserMessageDomainService: AppendUserMessageDomainService,
    private readonly llmPromptDomainService: LlmPromptDomainService,
  ) {}

  async execute(request: LlmCompletionRequest): Promise<Result<void, ValidationError | NotFoundError | StoreError | LlmError>> {
    const triggerMessageResult = await this.messageDomainService.findById(request.messageId);

    if (!triggerMessageResult.ok) {
      return triggerMessageResult;
    }

    const triggerMessage = triggerMessageResult.value;
    const allMessagesResult = await this.messageDomainService.findAll(triggerMessage.conversationId);

    if (!allMessagesResult.ok) {
      return allMessagesResult;
    }

    const triggerValidationResult = this.validateTriggerMessage(triggerMessage, allMessagesResult.value);

    if (!triggerValidationResult.ok) {
      return triggerValidationResult;
    }

    const filesResult = await this.fileDomainService.getFilesOnMessages({
      messageIds: allMessagesResult.value.map((message) => message.id),
    });

    if (!filesResult.ok) {
      return filesResult;
    }

    const signedFilesResult = await this.fileAccessDomainService.createSignedFileAccess(filesResult.value);

    if (!signedFilesResult.ok) {
      return signedFilesResult;
    }

    const llmInput = this.buildLlmInputMessages(allMessagesResult.value, signedFilesResult.value);
    const llmResult = await this.llmCompletionService.llmComplete(llmInput);

    if (!llmResult.ok) {
      return llmResult;
    }

    if (llmResult.value.messages.length === 0) {
      return { ok: true, value: undefined };
    }

    return this.appendCompletionMessages(triggerMessage.conversationId, llmResult.value.messages);
  }

  private async appendCompletionMessages(
    conversationId: string,
    messages: ReadonlyArray<LlmCompletionMessage>,
  ): Promise<Result<void, ValidationError | StoreError>> {
    const nextMessageRecordsResult = await this.messageDomainService.buildNextMessageRecords({
      conversationId,
      messages,
    });

    if (!nextMessageRecordsResult.ok) {
      return nextMessageRecordsResult;
    }

    const appendMessageResult = await this.appendUserMessageDomainService.persistMessages({
      messages: nextMessageRecordsResult.value,
    });

    if (!appendMessageResult.ok) {
      return appendMessageResult;
    }

    return { ok: true, value: undefined };
  }

  private validateTriggerMessage(triggerMessage: Message, allMessages: ReadonlyArray<Message>): Result<void, ValidationError> {
    const latestMessage = allMessages.at(-1);

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

    return success(undefined);
  }

  private buildLlmInputMessages(messages: ReadonlyArray<Message>, files: ReadonlyArray<SignedFileAccess>): LlmCompletionInputMessage[] {
    const filesByMessageId = new Map<string, LlmCompletionInputFile[]>();

    for (const file of files) {
      const messageFiles = filesByMessageId.get(file.messageId) ?? [];
      messageFiles.push({
        filename: file.filename,
        mimeType: file.mimeType,
        signedUrl: file.signedUrl,
      });
      filesByMessageId.set(file.messageId, messageFiles);
    }

    const renderedMessages = messages.map((message) => ({
      type: message.type,
      content: this.llmPromptDomainService.renderMessageContent(message),
      files: filesByMessageId.get(message.id) ?? [],
    }));

    return [this.llmPromptDomainService.buildSystemPrompt(), ...renderedMessages];
  }
}
