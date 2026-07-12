import type { LlmConfig } from "../../config/config";
import type { LlmService } from "../../domain/contracts/llm-service";
import { LlmError } from "../../domain/objects/errors";
import { LLMMessageType, type LlmCompletionInputFile, type LlmCompletionInputMessage, type LlmCompletionMessage, type LlmToolDefinition } from "../../domain/objects/llm";
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

interface GeminiFunctionCallPart {
  readonly functionCall: {
    readonly id?: string;
    readonly name: string;
    readonly args?: Record<string, unknown>;
  };
  readonly thoughtSignature?: string;
}

interface GeminiFunctionResponsePart {
  readonly functionResponse: {
    readonly id: string;
    readonly name: string;
    readonly response: Record<string, unknown>;
  };
}

type GeminiPart = GeminiTextPart | GeminiInlineDataPart | GeminiFunctionCallPart | GeminiFunctionResponsePart;

interface GeminiContent {
  readonly role?: GeminiContentRole;
  readonly parts: ReadonlyArray<GeminiPart>;
}

interface GeminiGenerateContentRequest {
  readonly contents: GeminiContent[];
  readonly systemInstruction?: GeminiContent;
  readonly tools?: ReadonlyArray<{
    readonly functionDeclarations: ReadonlyArray<{
      readonly name: string;
      readonly description: string;
      readonly parametersJsonSchema: Readonly<Record<string, unknown>>;
    }>;
  }>;
}

interface GeminiGenerateContentResponse {
  readonly candidates?: ReadonlyArray<{
    readonly content?: {
      readonly parts?: ReadonlyArray<{
        readonly text?: string;
        readonly functionCall?: {
          readonly id?: string;
          readonly name: string;
          readonly args?: Record<string, unknown>;
        };
        readonly thoughtSignature?: string;
      }>;
      readonly role?: GeminiContentRole;
    };
  }>;
  readonly error?: {
    readonly message?: string;
  };
}

export class GeminiLlmAdapter implements LlmService {
  constructor(
    private readonly config: LlmConfig,
    private readonly toolDefinitions: ReadonlyArray<LlmToolDefinition> = [],
  ) {}

  async llmComplete(messages: ReadonlyArray<LlmCompletionInputMessage | LlmCompletionMessage>): Promise<Result<LlmCompletionMessage, LlmError>> {
    try {
      const request = await toGeminiGenerateContentRequest(messages, this.toolDefinitions);
      const response = await this.generateContent(request);

      return success(toLlmCompletionMessage(response));
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

async function toGeminiGenerateContentRequest(
  messages: ReadonlyArray<LlmCompletionInputMessage | LlmCompletionMessage>,
  tools: ReadonlyArray<LlmToolDefinition>,
): Promise<GeminiGenerateContentRequest> {
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
    ...(tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                parametersJsonSchema: tool.inputSchema,
              })),
            },
          ],
        }
      : {}),
  };
}

async function toGeminiContent(message: LlmCompletionInputMessage | LlmCompletionMessage): Promise<GeminiContent> {
  if ("providerContext" in message && isGeminiContent(message.providerContext)) {
    return message.providerContext;
  }

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

async function toGeminiParts(message: LlmCompletionInputMessage | LlmCompletionMessage): Promise<GeminiPart[]> {
  if (message.type === LLMMessageType.Tool && "toolCallId" in message && message.toolCallId && message.toolName) {
    return [
      {
        functionResponse: {
          id: message.toolCallId,
          name: message.toolName,
          response: parseToolOutput(message.content),
        },
      },
    ];
  }

  const parts: GeminiPart[] = [];
  const text = toGeminiText(message);

  if (text.length > 0) {
    parts.push({ text });
  }

  if ("files" in message) {
    for (const file of message.files) {
      parts.push(await toGeminiInlineDataPart(file));
    }
  }

  return parts;
}

function toGeminiText(message: LlmCompletionInputMessage | LlmCompletionMessage): string {
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

function toGeminiResponseContent(response: GeminiGenerateContentResponse): GeminiContent | undefined {
  const content = response.candidates?.[0]?.content;

  if (!content?.parts) {
    return undefined;
  }

  return {
    role: content.role ?? "model",
    parts: content.parts.map((part) => {
      if (part.functionCall) {
        return {
          functionCall: part.functionCall,
          ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
        };
      }

      return { text: part.text ?? "", ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}) };
    }),
  };
}

function toLlmCompletionMessage(response: GeminiGenerateContentResponse): LlmCompletionMessage {
  const content = toGeminiResponseContent(response);

  if (!content) {
    return { type: LLMMessageType.Assistant, content: "" };
  }

  const text = content.parts
    .map((part) => ("text" in part ? part.text : ""))
    .join("")
    .trim();
  const toolCalls = content.parts.flatMap((part) => {
    if (!("functionCall" in part)) {
      return [];
    }

    if (!part.functionCall.id) {
      throw new Error(`Gemini tool call ${part.functionCall.name} did not include an id.`);
    }

    return [
      {
        id: part.functionCall.id,
        name: part.functionCall.name,
        inputs: part.functionCall.args ?? {},
      },
    ];
  });

  return {
    type: LLMMessageType.Assistant,
    content: text,
    ...(toolCalls.length > 0 ? { toolCalls, providerContext: content } : {}),
  };
}

function isGeminiContent(value: unknown): value is GeminiContent {
  return typeof value === "object" && value !== null && "parts" in value && Array.isArray(value.parts);
}

function parseToolOutput(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;

    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return { result: parsed };
  } catch {
    return { result: content };
  }
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
