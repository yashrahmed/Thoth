import { AIMessage, type BaseMessage, type ContentBlock, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";

import type { LlmConfig } from "../../config/config";
import type { LlmService } from "../../domain/contracts/llm-service";
import { LlmError } from "../../domain/objects/errors";
import { LLMMessageType, type LlmCompletionInputMessage, type LlmCompletionMessage, type LlmCompletionResult } from "../../domain/objects/llm";
import { failure, success, type Result } from "../../domain/objects/result";

export const OPENAI_LLM_MODEL = "gpt-5.4";
const MAX_TOOL_CALL_ROUNDS = 5;
const OPENAI_REQUEST_TIMEOUT_MS = 15_000;

export interface OpenAiTool {
  readonly name: string;
  execute(args: Record<string, unknown>): Promise<string>;
}

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

  // maxRetries=0 disables LangChain's built-in retry loop. The background
  // completion runner already surfaces LlmError as a visible fallback message
  // (see BackgroundLLMCompletionRunService), so a slow self-heal would only
  // delay the failure the user already sees. Fast failure beats slow retry.
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
  private readonly model: ChatOpenAI;
  private readonly toolsByName: ReadonlyMap<string, OpenAiTool>;

  constructor(
    config: LlmConfig,
    tools: ReadonlyArray<OpenAiTool> = [],
  ) {
    this.model = getOrCreateChatOpenAI(config);
    this.toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  async llmComplete(messages: ReadonlyArray<LlmCompletionInputMessage>): Promise<Result<LlmCompletionResult, LlmError>> {
    try {
      const completionMessages = await this.complete(messages.map(toLangChainMessage));

      if (completionMessages.length === 0) {
        return success({ messages: [] });
      }

      return success({
        messages: completionMessages,
      });
    } catch (error) {
      const code = error instanceof TimeoutError ? "timeout" : "other";
      return failure(new LlmError(getErrorMessage(error), code));
    }
  }

  private async complete(messages: ReadonlyArray<BaseMessage>): Promise<ReadonlyArray<LlmCompletionMessage>> {
    const transcript: BaseMessage[] = [...messages];
    const completionMessages: LlmCompletionMessage[] = [];

    for (let round = 0; round <= MAX_TOOL_CALL_ROUNDS; round += 1) {
      const response = await withTimeout(this.model.invoke(transcript), OPENAI_REQUEST_TIMEOUT_MS, `OpenAI invoke timed out after ${OPENAI_REQUEST_TIMEOUT_MS} ms.`);
      transcript.push(response);

      if (response.text.trim().length > 0) {
        completionMessages.push({
          type: LLMMessageType.Assistant,
          content: response.text,
        });
      }

      if (response.tool_calls === undefined || response.tool_calls.length === 0) {
        return completionMessages;
      }

      for (const toolCall of response.tool_calls) {
        const tool = this.toolsByName.get(toolCall.name);

        if (!tool) {
          throw new Error(`OpenAI requested unsupported tool ${toolCall.name}.`);
        }

        const content = await tool.execute(toolCall.args);
        const toolCallId = toolCall.id ?? toolCall.name;
        transcript.push(new ToolMessage({ content, tool_call_id: toolCallId }));
        completionMessages.push({
          type: LLMMessageType.Tool,
          content,
        });
      }
    }

    throw new Error(`OpenAI tool call loop exceeded ${MAX_TOOL_CALL_ROUNDS} rounds.`);
  }
}

function toLangChainMessage(message: LlmCompletionInputMessage): BaseMessage {
  switch (message.type) {
    case LLMMessageType.User:
      return toHumanMessage(message);
    case LLMMessageType.Assistant:
      return new AIMessage(message.content);
    case LLMMessageType.System:
      return new SystemMessage(message.content);
    case LLMMessageType.Tool:
      // Domain tool messages do not yet store provider tool_call_id values.
      return new HumanMessage(`Tool result:\n${message.content}`);
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
