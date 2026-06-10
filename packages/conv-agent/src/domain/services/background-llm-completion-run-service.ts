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

const THOTH_SENT_AT_METADATA_LINE_PATTERN = /^sent at \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \+00:00 UTC$/gm;

/**
 * Runs the LLM completion as a background task scheduled via the supplied
 * scheduler (typically `ctx.waitUntil` on Cloudflare Workers). The prompt is
 * built from the ancestor chain of the parent message, so sibling branches
 * never leak into the context. The first completion message is attached at the
 * caller-declared append position; a duplicate or stale run loses the slot to
 * the store's next-child check and is dropped without side effects. Errors are
 * logged. On `LlmError` (e.g. timeout, provider error) a generic assistant
 * message is appended at the same position so the failure is visible to the
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
    this.scheduleBackgroundTask(this.executeAndLog(input));
  }

  private async executeAndLog(input: RunLlmCompletionInput): Promise<void> {
    const { conversationId, parentMessageId, appendPosition } = input;

    try {
      const contextResult = await this.resolveCompletionContext(conversationId, parentMessageId);

      if (!contextResult.ok) {
        console.error("[conv-agent] background LLM completion failed", {
          conversationId,
          parentMessageId,
          phase: "context",
          error: this.serializeCompletionError(contextResult.error),
        });
        return;
      }

      const { llmInput } = contextResult.value;
      const llmResult = await this.llmService.llmComplete(llmInput);

      if (!llmResult.ok) {
        console.error("[conv-agent] background LLM completion failed", {
          conversationId,
          parentMessageId,
          phase: "llm",
          error: this.serializeCompletionError(llmResult.error),
        });
        await this.persistFallbackAssistantMessage(input, llmResult.error.code);
        return;
      }

      if (llmResult.value.messages.length === 0) {
        return;
      }

      const persistResult = await this.appendCompletionMessages(input, llmResult.value.messages);

      if (!persistResult.ok) {
        if (isOccupiedAppendPositionError(persistResult.error)) {
          // The declared slot was taken before this run persisted — a duplicate
          // run already landed, or a concurrent append claimed the position.
          // Either way this run's intent is stale; drop it without a fallback.
          console.info("[conv-agent] background LLM completion dropped; append position is occupied", {
            conversationId,
            parentMessageId,
            appendPosition,
          });
          return;
        }

        console.error("[conv-agent] background LLM completion failed", {
          conversationId,
          parentMessageId,
          phase: "persist",
          error: this.serializeCompletionError(persistResult.error),
        });
      }
    } catch (error) {
      console.error("[conv-agent] background LLM completion threw", {
        conversationId,
        parentMessageId,
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
      });
    }
  }

  private async resolveCompletionContext(conversationId: string, parentMessageId: string): Promise<Result<CompletionContext, ValidationError | NotFoundError | StoreError>> {
    const ancestorChainResult = await this.messageDomainService.findAncestorChain({ conversationId, messageId: parentMessageId });

    if (!ancestorChainResult.ok) {
      return ancestorChainResult;
    }

    const filesResult = await this.fileDomainService.getFilesOnMessages({
      messageIds: ancestorChainResult.value.map((message) => message.id),
    });

    if (!filesResult.ok) {
      return filesResult;
    }

    const signedFilesResult = await this.fileAccessDomainService.createSignedFileAccess(filesResult.value);

    if (!signedFilesResult.ok) {
      return signedFilesResult;
    }

    return success({
      conversationId,
      llmInput: this.buildLlmInputMessages(ancestorChainResult.value, signedFilesResult.value),
    });
  }

  private async persistFallbackAssistantMessage(input: RunLlmCompletionInput, code: LlmErrorCode): Promise<void> {
    const fallbackMessage: LlmCompletionMessage = {
      type: LLMMessageType.Assistant,
      content: FALLBACK_MESSAGE_BY_CODE[code],
    };

    const persistResult = await this.appendCompletionMessages(input, [fallbackMessage]);

    if (!persistResult.ok) {
      if (isOccupiedAppendPositionError(persistResult.error)) {
        console.info("[conv-agent] fallback assistant message dropped; append position is occupied", {
          conversationId: input.conversationId,
          parentMessageId: input.parentMessageId,
          appendPosition: input.appendPosition,
        });
        return;
      }

      console.error("[conv-agent] failed to persist fallback assistant message", {
        conversationId: input.conversationId,
        parentMessageId: input.parentMessageId,
        error: this.serializeCompletionError(persistResult.error),
      });
    }
  }

  private async appendCompletionMessages(input: RunLlmCompletionInput, messages: ReadonlyArray<LlmCompletionMessage>): Promise<Result<void, ValidationError | StoreError>> {
    const sanitizedMessages = this.sanitizeCompletionMessages(messages);

    if (sanitizedMessages.length === 0) {
      return success(undefined);
    }

    const nextMessageRecordsResult = this.messageDomainService.buildNextMessageRecords({
      conversationId: input.conversationId,
      messages: sanitizedMessages,
    });

    if (!nextMessageRecordsResult.ok) {
      return nextMessageRecordsResult;
    }

    const appendMessageResult = await this.appendUserMessageDomainService.persistMessages({
      messages: nextMessageRecordsResult.value,
      parentMessageId: input.parentMessageId,
      appendPosition: input.appendPosition,
    });

    if (!appendMessageResult.ok) {
      return appendMessageResult;
    }

    return { ok: true, value: undefined };
  }

  private sanitizeCompletionMessages(messages: ReadonlyArray<LlmCompletionMessage>): LlmCompletionMessage[] {
    return messages
      .map((message) => {
        if (message.type !== LLMMessageType.Assistant) {
          return message;
        }

        // Providers can copy Thoth's synthetic timestamp metadata from prompt
        // history into their answer. Strip exact standalone metadata lines at
        // the completion boundary so future adapters get the same protection
        // before assistant-authored content is persisted.
        return {
          ...message,
          content: message.content.replace(THOTH_SENT_AT_METADATA_LINE_PATTERN, "").trim(),
        };
      })
      .filter((message) => message.content.length > 0);
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

function isOccupiedAppendPositionError(error: ValidationError | StoreError): boolean {
  return error instanceof ValidationError && error.fieldName === "appendPosition";
}
