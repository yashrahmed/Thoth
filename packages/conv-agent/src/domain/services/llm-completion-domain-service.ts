import type { LlmService } from "../contracts/llm-service";
import { LlmError, type NotFoundError, type StoreError, type ValidationError } from "../objects/errors";
import { LLMMessageType, type LlmCompletionInputFile, type LlmCompletionInputMessage, type LlmCompletionMessage } from "../objects/llm";
import { failure, success, type Result } from "../objects/result";
import type { Message } from "../objects/message-types";
import type { FileAccessDomainService, SignedFileAccess } from "./file-access-domain-service";
import { type FileDomainService } from "./file-domain-service";
import type { LlmPromptDomainService } from "./llm-prompt-domain-service";
import type { MessageDomainService } from "./message-domain-service";
import type { TimingToolsService } from "./timing-tools-service";

export interface LlmCompletionRequest {
  readonly conversationId: string;
  readonly messageIds: ReadonlyArray<string>;
}

const MAX_TOOL_CALL_ROUNDS = 5;

/**
 * Produces an LLM completion and returns the resulting messages to the caller
 * without persisting anything. The prompt consists of the system prompt
 * followed by exactly the requested messages, in the order their ids were
 * given: the caller shapes the chat. Whether the completion is appended to
 * the conversation is also the caller's decision.
 */
export class LlmCompletionDomainService {
  constructor(
    private readonly messageDomainService: MessageDomainService,
    private readonly fileDomainService: FileDomainService,
    private readonly fileAccessDomainService: FileAccessDomainService,
    private readonly llmService: LlmService,
    private readonly llmPromptDomainService: LlmPromptDomainService,
    private readonly timingToolsService: TimingToolsService,
  ) {}

  async complete(request: LlmCompletionRequest): Promise<Result<LlmCompletionMessage[], ValidationError | NotFoundError | StoreError | LlmError>> {
    const historyResult = await this.messageDomainService.findMessagesByIds({
      conversationId: request.conversationId,
      messageIds: request.messageIds,
    });

    if (!historyResult.ok) {
      return historyResult;
    }

    const filesResult = await this.fileDomainService.getFilesOnMessages({
      messageIds: historyResult.value.map((message) => message.id),
    });

    if (!filesResult.ok) {
      return filesResult;
    }

    const signedFilesResult = await this.fileAccessDomainService.createSignedFileAccess(filesResult.value);

    if (!signedFilesResult.ok) {
      return signedFilesResult;
    }

    return this.completeWithTools(this.buildLlmInputMessages(historyResult.value, signedFilesResult.value), historyResult.value);
  }

  private async completeWithTools(
    initialMessages: ReadonlyArray<LlmCompletionInputMessage>,
    messageContext: ReadonlyArray<Message>,
  ): Promise<Result<LlmCompletionMessage[], LlmError>> {
    const transcript: Array<LlmCompletionInputMessage | LlmCompletionMessage> = [...initialMessages];

    for (let round = 0; ; round += 1) {
      const llmResult = await this.llmService.llmComplete(transcript);

      if (!llmResult.ok) {
        return llmResult;
      }

      const response = llmResult.value;
      transcript.push(response);
      const toolCalls = response.toolCalls ?? [];

      if (toolCalls.length === 0) {
        return success(response.content.length > 0 ? [{ type: response.type, content: response.content }] : []);
      }

      if (round >= MAX_TOOL_CALL_ROUNDS) {
        return failure(new LlmError(`LLM tool call loop exceeded ${MAX_TOOL_CALL_ROUNDS} rounds.`));
      }

      for (const toolCall of toolCalls) {
        try {
          transcript.push({
            type: LLMMessageType.Tool,
            content: await this.timingToolsService.run_tool(toolCall.name, toolCall.inputs, messageContext),
            toolCallId: toolCall.id,
            toolName: toolCall.name,
          });
        } catch (error) {
          return failure(error instanceof LlmError ? error : new LlmError(getErrorMessage(error)));
        }
      }
    }
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected timing tool execution error.";
}
