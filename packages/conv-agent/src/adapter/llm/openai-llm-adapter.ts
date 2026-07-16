import { AIMessage, type BaseMessage, type ContentBlock, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

import type { LlmConfig } from "../../config/config";
import type { LlmService } from "../../domain/contracts/llm-service";
import { LlmError } from "../../domain/objects/errors";
import { LLMMessageType, LlmModel, type LlmCompletionInputMessage, type LlmCompletionMessage, type LlmToolDefinition } from "../../domain/objects/llm";
import { failure, success, type Result } from "../../domain/objects/result";

const OPENAI_LLM_MODEL = LlmModel.OpenAiGpt54;
const OPENAI_REQUEST_TIMEOUT_MS = 25_000;

// Module-scope cache for the ChatOpenAI client. The dependency graph (and the
// adapter wrapping this client) is rebuilt per request because Cloudflare
// Workers forbids reusing I/O objects across requests — but ChatOpenAI itself
// is a config + fetch-closure wrapper with no live socket, so it is safe to
// hoist. Reusing it skips LangChain's per-request setup (zod schema build,
// validator wiring). The cache is keyed on apiKey so an env rotation or a
// system test with a different key transparently gets its own client.
//
// A cached copy is not always available: cold isolates start empty and pay
// the first-request construction cost, and any apiKey change invalidates the
// entry. Callers must treat this as a best-effort hot-path optimization, not
// a guarantee.
let cachedChatOpenAI: ChatOpenAI | undefined;
let cachedChatOpenAIApiKey: string | undefined;

function getOrCreateChatOpenAI(config: LlmConfig): ChatOpenAI {
  if (cachedChatOpenAI && cachedChatOpenAIApiKey === config.apiKey) {
    return cachedChatOpenAI;
  }

  // maxRetries=0 disables LangChain's built-in retry loop. Completion requests
  // are synchronous and surface LlmError directly to the caller, so a slow
  // self-heal would only delay the failure the client already sees. Fast
  // failure beats slow retry.
  cachedChatOpenAI = new ChatOpenAI({
    apiKey: config.apiKey,
    model: OPENAI_LLM_MODEL,
    useResponsesApi: true,
    reasoning: { effort: "low" },
    maxRetries: 0,
    timeout: OPENAI_REQUEST_TIMEOUT_MS,
  });
  cachedChatOpenAIApiKey = config.apiKey;

  return cachedChatOpenAI;
}

export class OpenAiLlmAdapter implements LlmService {
  private readonly model: ReturnType<ChatOpenAI["bindTools"]>;

  constructor(config: LlmConfig, toolDefinitions: ReadonlyArray<LlmToolDefinition> = []) {
    this.model = getOrCreateChatOpenAI(config).bindTools(toolDefinitions.map(toOpenAiTool), {
      strict: true,
      parallel_tool_calls: false,
    });
  }

  async llmComplete(messages: ReadonlyArray<LlmCompletionInputMessage | LlmCompletionMessage>): Promise<Result<LlmCompletionMessage, LlmError>> {
    try {
      const response = await withTimeout(
        this.model.invoke(messages.map(toLangChainMessage)),
        OPENAI_REQUEST_TIMEOUT_MS,
        `OpenAI invoke timed out after ${OPENAI_REQUEST_TIMEOUT_MS} ms.`,
      );

      return success(toLlmCompletionMessage(response));
    } catch (error) {
      const code = error instanceof TimeoutError ? "timeout" : "other";
      return failure(new LlmError(getErrorMessage(error), code));
    }
  }
}

function toLlmCompletionMessage(response: AIMessage): LlmCompletionMessage {
  const toolCalls = (response.tool_calls ?? []).map((toolCall) => ({
    id: toolCall.id ?? toolCall.name,
    name: toolCall.name,
    inputs: toolCall.args,
  }));

  return {
    type: LLMMessageType.Assistant,
    content: response.text.trim(),
    ...(toolCalls.length > 0 ? { toolCalls, providerContext: response } : {}),
  };
}

function toOpenAiTool(tool: LlmToolDefinition): {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: Readonly<Record<string, unknown>>;
  };
} {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function toLangChainMessage(message: LlmCompletionInputMessage | LlmCompletionMessage): BaseMessage {
  if ("providerContext" in message && message.providerContext instanceof AIMessage) {
    return message.providerContext;
  }

  switch (message.type) {
    case LLMMessageType.User:
      return toHumanMessage(message);
    case LLMMessageType.Assistant:
      return new AIMessage(message.content);
    case LLMMessageType.System:
      return new SystemMessage(message.content);
    case LLMMessageType.Tool:
      return "toolCallId" in message && message.toolCallId
        ? new ToolMessage({ content: message.content, tool_call_id: message.toolCallId })
        : new HumanMessage(`Tool result:\n${message.content}`);
  }
}

function toHumanMessage(message: LlmCompletionInputMessage): HumanMessage {
  if (message.files.length === 0) {
    return new HumanMessage(message.content);
  }

  return new HumanMessage({
    content: toHumanMessageContentBlocks(message),
    response_metadata: { output_version: "v1" },
  });
}

function toHumanMessageContentBlocks(message: LlmCompletionInputMessage): ContentBlock[] {
  const contentBlocks: ContentBlock[] = [];

  if (message.content.length > 0) {
    contentBlocks.push({ type: "text", text: message.content });
  }

  contentBlocks.push(
    ...message.files.map((file) => ({
      type: getContentBlockType(file.mimeType),
      url: file.signedUrl,
      mimeType: file.mimeType,
    })),
  );

  return contentBlocks;
}

function getContentBlockType(mimeType: string): "file" | "image" {
  return mimeType.startsWith("image/") ? "image" : "file";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected OpenAI LLM completion error.";
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
