import type { LlmConfig } from "../../config/config";
import type { LlmCompletionService } from "../../domain/contracts/llm-completion-service";
import type { LlmError } from "../../domain/objects/errors";
import { LLMMessageType, type LlmCompletionInputMessage, type LlmCompletionResult } from "../../domain/objects/llm";
import { success, type Result } from "../../domain/objects/result";
import { withSentAtHeader } from "./sent-at-header";

export class PlaceholderLlmAdapter implements LlmCompletionService {
  constructor(private readonly config: LlmConfig) {}

  async llmComplete(messages: ReadonlyArray<LlmCompletionInputMessage>): Promise<Result<LlmCompletionResult, LlmError>> {
    void this.config.apiKey;

    const latestMessage = messages.at(-1);

    if (!latestMessage) {
      return success({
        messages: [
          {
            type: LLMMessageType.Assistant,
            content: "No conversation context available.",
          },
        ],
      });
    }

    const renderedLatest = withSentAtHeader(latestMessage);

    if (latestMessage.content.includes("[simulate-tool-trace]")) {
      const visibleContent = renderedLatest.replace("[simulate-tool-trace]", "").trim();

      return success({
        messages: [
          {
            type: LLMMessageType.Assistant,
            content: visibleContent,
          },
          {
            type: LLMMessageType.Tool,
            content: `Tool result for: ${visibleContent}`,
          },
          {
            type: LLMMessageType.Assistant,
            content: `Final answer for: ${visibleContent}`,
          },
        ],
      });
    }

    return success({
      messages: [
        {
          type: LLMMessageType.Assistant,
          content: renderedLatest.trim().length > 0 ? renderedLatest : "No textual content available.",
        },
      ],
    });
  }
}
