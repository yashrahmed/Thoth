import type { LlmCompletionService } from "../../domain/contracts/llm-completion-service";
import type { LlmCompletionResult } from "../../domain/objects/llm";
import type { Message, MessagePart, TextPart } from "../../domain/objects/message";
import { success, type Result } from "../../domain/objects/result";
import type { LlmError } from "../../domain/objects/errors";

export class PlaceholderLlmRepository implements LlmCompletionService {
  async llmComplete(messages: ReadonlyArray<Message>): Promise<Result<LlmCompletionResult, LlmError>> {
    const latestMessage = messages.at(-1);

    if (!latestMessage) {
      return success({
        content: [
          {
            type: "text",
            text: "No conversation context available.",
          },
        ],
      });
    }

    const textParts = latestMessage.content.filter((part): part is TextPart => part.type === "text");

    return success({
      content: textParts.length > 0 ? textParts.map((part) => cloneTextPart(part)) : [cloneTextPart({ type: "text", text: "No textual content available." })],
    });
  }
}

function cloneTextPart(messagePart: TextPart): MessagePart {
  return {
    type: "text",
    text: messagePart.text,
  };
}
