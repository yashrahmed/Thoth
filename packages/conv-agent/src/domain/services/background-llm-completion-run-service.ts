import type { LlmService } from "../contracts/llm-service";
import type { LLMCompletionRunService, RunLlmCompletionInput } from "../contracts/llm-completion-run-service";
import { LLMMessageType, type LlmCompletionInputFile, type LlmCompletionInputMessage, type LlmCompletionMessage } from "../objects/llm";
import { LlmError, ValidationError, type LlmErrorCode, type NotFoundError, type StoreError } from "../objects/errors";
import { success, type Result } from "../objects/result";
import type { Message } from "../objects/message-types";
import type { AppendUserMessageDomainService } from "./append-user-message-domain-service";
import type { FileAccessDomainService, SignedFileAccess } from "./file-access-domain-service";
import { type FileDomainService } from "./file-domain-service";
import type { LlmPromptDomainService } from "./llm-prompt-domain-service";
import type { MessageDomainService } from "./message-domain-service";

interface CompletionContext {
  readonly conversationId: string;
  readonly llmInput: ReadonlyArray<LlmCompletionInputMessage>;
}

const FALLBACK_MESSAGE_BY_CODE: Record<LlmErrorCode, string> = {
  timeout: "Sorry — the assistant timed out while generating a reply. Please try again.",
  other: "Sorry — the assistant could not generate a reply. Please try again.",
};

/**
 * Runs the LLM completion as a background task scheduled via the supplied
 * scheduler (typically `ctx.waitUntil` on Cloudflare Workers). Errors are
 * logged. On `LlmError` (e.g. timeout, provider error) a generic assistant
 * message is appended to the conversation so the failure is visible to the
 * user instead of silently dropped. There is no retry path.
 */
export class BackgroundLLMCompletionRunService implements LLMCompletionRunService {
  constructor(
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
    private readonly fileAccessDomainService: FileAccessDomainService,
    private readonly llmService: LlmService,
    private readonly appendUserMessageDomainService: AppendUserMessageDomainService,
    private readonly llmPromptDomainService: LlmPromptDomainService,
    private readonly scheduleBackgroundTask: (task: Promise<unknown>) => void,
  ) {}

  run(input: RunLlmCompletionInput): void {
    this.scheduleBackgroundTask(this.executeAndLog(input.messageId));
  }

  private async executeAndLog(messageId: string): Promise<void> {
    try {
      const contextResult = await this.resolveCompletionContext(messageId);

      if (!contextResult.ok) {
        // Validation/NotFound/StoreError happen before we reach the LLM. The
        // most common case is the supersede ValidationError, which is intentional
        // (a newer user message will trigger its own completion). Don't write a
        // fallback assistant message — just log.
        console.error("[conv-agent] background LLM completion failed", {
          messageId,
          phase: "context",
          error: this.serializeCompletionError(contextResult.error),
        });
        return;
      }

      const { conversationId, llmInput } = contextResult.value;
      const llmResult = await this.llmService.llmComplete(llmInput);

      if (!llmResult.ok) {
        console.error("[conv-agent] background LLM completion failed", {
          messageId,
          phase: "llm",
          error: this.serializeCompletionError(llmResult.error),
        });
        await this.persistFallbackAssistantMessage(messageId, conversationId, llmResult.error.code);
        return;
      }

      if (llmResult.value.messages.length === 0) {
        return;
      }

      const persistResult = await this.appendCompletionMessages(conversationId, llmResult.value.messages);

      if (!persistResult.ok) {
        console.error("[conv-agent] background LLM completion failed", {
          messageId,
          phase: "persist",
          error: this.serializeCompletionError(persistResult.error),
        });
      }
    } catch (error) {
      console.error("[conv-agent] background LLM completion threw", {
        messageId,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
      });
    }
  }

  private async resolveCompletionContext(messageId: string): Promise<Result<CompletionContext, ValidationError | NotFoundError | StoreError>> {
    const triggerMessageResult = await this.messageDomainService.findById(messageId);

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

    return success({
      conversationId: triggerMessage.conversationId,
      llmInput: this.buildLlmInputMessages(allMessagesResult.value, signedFilesResult.value),
    });
  }

  private async persistFallbackAssistantMessage(messageId: string, conversationId: string, code: LlmErrorCode): Promise<void> {
    const fallbackMessage: LlmCompletionMessage = {
      type: LLMMessageType.Assistant,
      content: FALLBACK_MESSAGE_BY_CODE[code],
    };

    const persistResult = await this.appendCompletionMessages(conversationId, [fallbackMessage]);

    if (!persistResult.ok) {
      console.error("[conv-agent] failed to persist fallback assistant message", {
        messageId,
        conversationId,
        error: this.serializeCompletionError(persistResult.error),
      });
    }
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

  private serializeCompletionError(error: ValidationError | NotFoundError | StoreError | LlmError): Record<string, unknown> {
    const base: Record<string, unknown> = {
      kind: error.constructor.name,
      message: "message" in error ? error.message : undefined,
      entityType: "entityType" in error ? error.entityType : undefined,
      id: "id" in error ? error.id : undefined,
    };

    if (error instanceof LlmError) {
      base.code = error.code;
    }

    return base;
  }
}
