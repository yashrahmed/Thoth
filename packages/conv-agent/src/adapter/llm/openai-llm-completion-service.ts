import OpenAI from "openai";
import type { LlmCompletionService } from "../../domain/contracts/llm-completion-service";
import type { FileRepository } from "../../domain/contracts/file-repository";
import { LlmError } from "../../domain/objects/errors";
import type { File } from "../../domain/objects/file";
import type { LlmCompletionResult, LLMMessageType } from "../../domain/objects/llm";
import type { Message } from "../../domain/objects/message";
import { failure, success, type Result } from "../../domain/objects/result";

export const OPENAI_GPT_5_4_MODEL = "gpt-5.4";

interface OpenAiLlmCompletionServiceOptions {
  readonly model?: string;
  readonly fileRepository?: FileRepository;
}

interface CreateOpenAiLlmCompletionServiceOptions extends OpenAiLlmCompletionServiceOptions {
  readonly apiKey?: string;
}

export class OpenAiLlmCompletionService implements LlmCompletionService {
  private readonly model: string;
  private readonly fileRepository?: FileRepository;

  constructor(
    private readonly client: OpenAI,
    options: OpenAiLlmCompletionServiceOptions = {},
  ) {
    this.model = options.model ?? OPENAI_GPT_5_4_MODEL;
    this.fileRepository = options.fileRepository;
  }

  async llmComplete(messages: ReadonlyArray<Message>): Promise<Result<LlmCompletionResult, LlmError>> {
    try {
      const response = await this.client.responses.create({
        model: this.model,
        input: await renderMessagesAsPrompt(messages, this.fileRepository),
      });
      const outputText = response.output_text.trim();

      if (outputText.length === 0) {
        return failure(new LlmError("OpenAI returned an empty text response."));
      }

      return success({
        content: outputText,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenAI request failed.";

      return failure(new LlmError(message));
    }
  }
}

export function createOpenAiLlmCompletionService(options: CreateOpenAiLlmCompletionServiceOptions = {}): OpenAiLlmCompletionService {
  return new OpenAiLlmCompletionService(new OpenAI(options.apiKey ? { apiKey: options.apiKey } : {}), {
    model: options.model,
    fileRepository: options.fileRepository,
  });
}

async function renderMessagesAsPrompt(messages: ReadonlyArray<Message>, fileRepository?: FileRepository): Promise<string> {
  if (messages.length === 0) {
    return "No conversation context available.";
  }

  const filesById = await loadFilesById(messages, fileRepository);

  return messages
    .map((message) => {
      const contentLines = message.content.trim().length > 0 ? [message.content] : [];

      if (message.fileIds.length > 0) {
        contentLines.push(...message.fileIds.map((fileId) => renderAttachment(fileId, filesById.get(fileId))));
      }

      const content = contentLines.join("\n").trim();

      return `${renderRoleLabel(message.type)}\n${content.length > 0 ? content : "[no supported content]"}`;
    })
    .join("\n\n");
}

async function loadFilesById(messages: ReadonlyArray<Message>, fileRepository?: FileRepository): Promise<Map<string, File>> {
  const fileIds = [...new Set(messages.flatMap((message) => message.fileIds))];

  if (!fileRepository || fileIds.length === 0) {
    return new Map();
  }

  const filesResult = await fileRepository.selectFileRows(fileIds);

  if (!filesResult.ok) {
    throw new Error(filesResult.error.message);
  }

  return new Map(filesResult.value.map((file) => [file.id, file]));
}

function renderRoleLabel(type: LLMMessageType): string {
  return `[${type.toUpperCase()}]`;
}

function renderAttachment(fileId: string, file: File | undefined): string {
  if (!file) {
    return `[attachment id=${fileId}]`;
  }

  return `[${inferAttachmentKind(file.mimeType)} id=${file.id} filename=${file.filename} mimeType=${file.mimeType} url=${file.canonicalUrl}]`;
}

function inferAttachmentKind(mimeType: string): "image" | "audio" | "file" {
  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  return "file";
}
