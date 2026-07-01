import type { LlmService } from "../contracts/llm-service";
import { LLMMessageType, type LlmCompletionInputFile, type LlmCompletionInputMessage, type LlmCompletionMessage } from "../objects/llm";
import type { LlmError, NotFoundError, StoreError, ValidationError } from "../objects/errors";
import { success, type Result } from "../objects/result";
import type { Message } from "../objects/message-types";
import type { FileAccessDomainService, SignedFileAccess } from "./file-access-domain-service";
import { type FileDomainService } from "./file-domain-service";
import type { LlmPromptDomainService } from "./llm-prompt-domain-service";
import type { MessageDomainService } from "./message-domain-service";

export interface LlmCompletionRequest {
  readonly conversationId: string;
  readonly messageId: string;
}

const THOTH_SENT_AT_METADATA_LINE_PATTERN = /^sent at \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \+00:00 UTC$/gm;

/**
 * Produces an LLM completion for a message and returns the resulting messages
 * to the caller without persisting anything. The prompt is built from the
 * ancestor chain of the target message, so sibling branches never leak into
 * the context. Whether (and where) the completion is appended to the
 * conversation is the caller's decision.
 */
export class LlmCompletionDomainService {
  constructor(
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
    private readonly fileAccessDomainService: FileAccessDomainService,
    private readonly llmService: LlmService,
    private readonly llmPromptDomainService: LlmPromptDomainService,
  ) {}

  async complete(request: LlmCompletionRequest): Promise<Result<LlmCompletionMessage[], ValidationError | NotFoundError | StoreError | LlmError>> {
    const ancestorChainResult = await this.messageDomainService.findAncestorChain({
      conversationId: request.conversationId,
      messageId: request.messageId,
    });

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

    const llmInput = this.buildLlmInputMessages(ancestorChainResult.value, signedFilesResult.value);
    const llmResult = await this.llmService.llmComplete(llmInput);

    if (!llmResult.ok) {
      return llmResult;
    }

    return success(this.sanitizeCompletionMessages(llmResult.value.messages));
  }

  private sanitizeCompletionMessages(messages: ReadonlyArray<LlmCompletionMessage>): LlmCompletionMessage[] {
    return messages
      .map((message) => {
        if (message.type !== LLMMessageType.Assistant) {
          return message;
        }

        // Providers can copy Thoth's synthetic timestamp metadata from prompt
        // history into their answer. Strip exact standalone metadata lines at
        // the completion boundary so every adapter gets the same protection
        // before assistant-authored content reaches the caller.
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
}
