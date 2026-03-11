import { createOpenAI } from "@ai-sdk/openai";
import { getLlmApiKey, getLlmConfig } from "@thoth/config";
import type {
  GenerateResponseInput,
  GenerateResponseOutput,
  LlmServicePort,
  LlmPromptMessage,
} from "@thoth/contracts";
import { generateText, type ModelMessage } from "ai";

type GenerateTextFn = typeof generateText;
type OpenAiModelFactory = ReturnType<typeof createOpenAI>;

export class OpenAiLlmService implements LlmServicePort {
  constructor(
    private readonly modelFactory: OpenAiModelFactory = createOpenAI({
      apiKey: getLlmApiKey(),
    }),
    private readonly generateTextFn: GenerateTextFn = generateText,
  ) {}

  async generateResponse(
    input: GenerateResponseInput,
  ): Promise<GenerateResponseOutput> {
    const llmConfig = getLlmConfig();

    if (llmConfig.provider !== "openai") {
      throw new Error(
        `Unsupported LLM provider "${llmConfig.provider}" for OpenAI adapter.`,
      );
    }

    const result = await this.generateTextFn({
      model: this.modelFactory(llmConfig.model),
      messages: mapPromptMessages(input.messages),
    });
    const text = result.text.trim();

    if (text.length === 0) {
      throw new Error("LLM provider returned an empty text response.");
    }

    return {
      message: {
        role: "assistant",
        text,
      },
    };
  }
}

export function mapPromptMessages(messages: LlmPromptMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: message.text,
      };
    }

    if (message.role === "user") {
      return {
        role: "user",
        content: message.text,
      };
    }

    return {
      role: "system",
      content: message.text,
    };
  });
}
