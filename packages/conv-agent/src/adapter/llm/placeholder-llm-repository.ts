import type { LlmCompletionService } from "../../domain/contracts/llm-completion-service";
import { LLMMessageType, type LlmCompletionResult } from "../../domain/objects/llm";
import type { Message } from "../../domain/objects/message-types";
import { success, type Result } from "../../domain/objects/result";
import type { LlmError } from "../../domain/objects/errors";
import type { LlmConfig } from "../../config/config";

export class PlaceholderLlmRepository implements LlmCompletionService {
  constructor(private readonly config: LlmConfig) {}

  async llmComplete(messages: ReadonlyArray<Message>): Promise<Result<LlmCompletionResult, LlmError>> {
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

    if (latestMessage.content.includes("[simulate-tool-trace]")) {
      const visibleContent = latestMessage.content.replace("[simulate-tool-trace]", "").trim();

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
          content: latestMessage.content.trim().length > 0 ? latestMessage.content : "No textual content available.",
        },
      ],
    });
  }
}
