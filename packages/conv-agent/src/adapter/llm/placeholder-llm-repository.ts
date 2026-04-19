import type { LlmCompletionService } from "../../domain/contracts/llm-completion-service";
import type { LlmCompletionResult } from "../../domain/objects/llm";
import type { Message } from "../../domain/objects/message-types";
import { success, type Result } from "../../domain/objects/result";
import type { LlmError } from "../../domain/objects/errors";

export class PlaceholderLlmRepository implements LlmCompletionService {
  async llmComplete(messages: ReadonlyArray<Message>): Promise<Result<LlmCompletionResult, LlmError>> {
    const latestMessage = messages.at(-1);

    if (!latestMessage) {
      return success({
        content: "No conversation context available.",
      });
    }

    return success({
      content: latestMessage.content.trim().length > 0 ? latestMessage.content : "No textual content available.",
    });
  }
}
