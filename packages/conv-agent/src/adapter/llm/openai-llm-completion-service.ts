import OpenAI from "openai";
import type { LlmCompletionService } from "../../domain/contracts/llm-completion-service";
import { LlmError } from "../../domain/objects/errors";
import type { LlmCompletionResult, LLMMessageType } from "../../domain/objects/llm";
import type { Message, MessagePart } from "../../domain/objects/message";
import { failure, success, type Result } from "../../domain/objects/result";

export const OPENAI_GPT_5_4_MODEL = "gpt-5.4";

interface OpenAiLlmCompletionServiceOptions {
  readonly model?: string;
}

interface CreateOpenAiLlmCompletionServiceOptions extends OpenAiLlmCompletionServiceOptions {
  readonly apiKey?: string;
}

export class OpenAiLlmCompletionService implements LlmCompletionService {
  private readonly model: string;

  constructor(
    private readonly client: OpenAI,
    options: OpenAiLlmCompletionServiceOptions = {},
  ) {
    this.model = options.model ?? OPENAI_GPT_5_4_MODEL;
  }

  async llmComplete(messages: ReadonlyArray<Message>): Promise<Result<LlmCompletionResult, LlmError>> {
    try {
      const response = await this.client.responses.create({
        model: this.model,
        input: renderMessagesAsPrompt(messages),
      });
      const outputText = response.output_text.trim();

      if (outputText.length === 0) {
        return failure(new LlmError("OpenAI returned an empty text response."));
      }

      return success({
        content: [
          {
            type: "text",
            text: outputText,
          },
        ],
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
  });
}

function renderMessagesAsPrompt(messages: ReadonlyArray<Message>): string {
  if (messages.length === 0) {
    return "No conversation context available.";
  }

  return messages
    .map((message) => {
      const content = message.content.map(renderMessagePart).join("\n").trim();

      return `${renderRoleLabel(message.type)}\n${content.length > 0 ? content : "[no supported content]"}`;
    })
    .join("\n\n");
}

function renderRoleLabel(type: LLMMessageType): string {
  return `[${type.toUpperCase()}]`;
}

function renderMessagePart(part: MessagePart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "image":
      return `[image fileId=${part.fileId}${renderOptionalValue("mediaType", part.mediaType)}]`;
    case "file":
      return `[file fileId=${part.fileId}${renderOptionalValue("filename", part.filename)}${renderOptionalValue("mediaType", part.mediaType)}]`;
    case "audio":
      return `[audio fileId=${part.fileId}${renderOptionalValue("mediaType", part.mediaType)}]`;
    case "tool-call":
      return `[tool-call id=${part.toolCallId} name=${part.toolName}] ${safeJsonStringify(part.input)}`;
    case "tool-result":
      return `[tool-result id=${part.toolCallId} name=${part.toolName}] ${safeJsonStringify(part.output)}`;
  }
}

function renderOptionalValue(name: string, value: string | undefined): string {
  if (!value) {
    return "";
  }

  return ` ${name}=${value}`;
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}
