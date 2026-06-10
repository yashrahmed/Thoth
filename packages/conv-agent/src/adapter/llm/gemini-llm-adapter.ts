import type { LlmConfig } from "../../config/config";
import type { LlmService } from "../../domain/contracts/llm-service";
import { LlmError } from "../../domain/objects/errors";
import { LLMMessageType, type LlmCompletionInputFile, type LlmCompletionInputMessage, type LlmCompletionMessage, type LlmCompletionResult } from "../../domain/objects/llm";
import { failure, success, type Result } from "../../domain/objects/result";

const GEMINI_3_FLASH_MODEL = "gemini-3-flash-preview";

const GEMINI_GENERATE_CONTENT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_REQUEST_TIMEOUT_MS = 25_000;

type GeminiContentRole = "user" | "model";

interface GeminiTextPart {
  readonly text: string;
}

interface GeminiInlineDataPart {
  readonly inline_data: {
    readonly mime_type: string;
    readonly data: string;
  };
}

type GeminiPart = GeminiTextPart | GeminiInlineDataPart;

interface GeminiContent {
  readonly role?: GeminiContentRole;
  readonly parts: ReadonlyArray<GeminiPart>;
}

interface GeminiGenerateContentRequest {
  readonly contents: ReadonlyArray<GeminiContent>;
  readonly systemInstruction?: GeminiContent;
}

interface GeminiGenerateContentResponse {
  readonly candidates?: ReadonlyArray<{
    readonly content?: {
      readonly parts?: ReadonlyArray<{
        readonly text?: string;
      }>;
    };
  }>;
  readonly error?: {
    readonly message?: string;
  };
}

export class GeminiLlmAdapter implements LlmService {
  constructor(private readonly config: LlmConfig) {}

  async llmComplete(messages: ReadonlyArray<LlmCompletionInputMessage>): Promise<Result<LlmCompletionResult, LlmError>> {
    try {
      const request = await toGeminiGenerateContentRequest(messages);
      const response = await this.generateContent(request);
      const completionMessages = toLlmCompletionMessages(response);

      return success({
        messages: completionMessages,
      });
    } catch (error) {
      const code = error instanceof TimeoutError ? "timeout" : "other";
      return failure(new LlmError(getErrorMessage(error), code));
    }
  }

  private async generateContent(request: GeminiGenerateContentRequest): Promise<GeminiGenerateContentResponse> {
    const url = `${GEMINI_GENERATE_CONTENT_ENDPOINT}/${GEMINI_3_FLASH_MODEL}:generateContent`;
    const response = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.config.apiKey,
        },
        body: JSON.stringify(request),
      }),
      GEMINI_REQUEST_TIMEOUT_MS,
      `Gemini invoke timed out after ${GEMINI_REQUEST_TIMEOUT_MS} ms.`,
    );

    const responseBody = await readGeminiResponse(response);

    if (!response.ok) {
      throw new Error(responseBody.error?.message ?? `Gemini API returned ${response.status}.`);
    }

    return responseBody;
  }
}

async function toGeminiGenerateContentRequest(messages: ReadonlyArray<LlmCompletionInputMessage>): Promise<GeminiGenerateContentRequest> {
  const systemParts = messages.filter((message) => message.type === LLMMessageType.System && message.content.length > 0).map((message) => ({ text: message.content }));
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.type === LLMMessageType.System) {
      continue;
    }

    const content = await toGeminiContent(message);
    if (content.parts.length > 0) {
      contents.push(content);
    }
  }

  if (contents.length === 0) {
    throw new Error("Gemini requires at least one content message.");
  }

  return {
    contents,
    ...(systemParts.length > 0
      ? {
          systemInstruction: {
            parts: systemParts,
          },
        }
      : {}),
  };
}

async function toGeminiContent(message: LlmCompletionInputMessage): Promise<GeminiContent> {
  return {
    role: toGeminiRole(message.type),
    parts: await toGeminiParts(message),
  };
}

function toGeminiRole(type: LLMMessageType): GeminiContentRole {
  if (type === LLMMessageType.Assistant) {
    return "model";
  }

  return "user";
}

async function toGeminiParts(message: LlmCompletionInputMessage): Promise<GeminiPart[]> {
  const parts: GeminiPart[] = [];
  const text = toGeminiText(message);

  if (text.length > 0) {
    parts.push({ text });
  }

  for (const file of message.files) {
    parts.push(await toGeminiInlineDataPart(file));
  }

  return parts;
}

function toGeminiText(message: LlmCompletionInputMessage): string {
  if (message.type === LLMMessageType.Tool) {
    return `Tool result:\n${message.content}`;
  }

  return message.content;
}

async function toGeminiInlineDataPart(file: LlmCompletionInputFile): Promise<GeminiInlineDataPart> {
  // Thoth stores provider-agnostic signed file URLs. Gemini's documented
  // file_uri path is for Gemini Files API / GCS URIs, so R2 signed HTTPS URLs
  // are translated into inline_data bytes here until direct URL support is
  // proven against the target model.
  const response = await withTimeout(fetch(file.signedUrl), GEMINI_REQUEST_TIMEOUT_MS, `Gemini file fetch timed out after ${GEMINI_REQUEST_TIMEOUT_MS} ms.`);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${file.filename} for Gemini: ${response.status}.`);
  }

  return {
    inline_data: {
      mime_type: file.mimeType,
      data: arrayBufferToBase64(await response.arrayBuffer()),
    },
  };
}

function toLlmCompletionMessages(response: GeminiGenerateContentResponse): ReadonlyArray<LlmCompletionMessage> {
  const text = response.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) {
    return [];
  }

  return [
    {
      type: LLMMessageType.Assistant,
      content: text,
    },
  ];
}

async function readGeminiResponse(response: Response): Promise<GeminiGenerateContentResponse> {
  const text = await response.text();

  if (text.length === 0) {
    return {};
  }

  try {
    return JSON.parse(text) as GeminiGenerateContentResponse;
  } catch {
    return {
      error: {
        message: text,
      },
    };
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32_768;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected Gemini LLM completion error.";
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
