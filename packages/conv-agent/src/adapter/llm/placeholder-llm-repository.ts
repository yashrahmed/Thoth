import type { LlmCompletionService } from "../../domain/contracts/llm-completion-service";
import { ContentPartType } from "../../domain/objects/content-part-type";
import type { LlmCompletionResult } from "../../domain/objects/llm";
import type { Message } from "../../domain/objects/message";
import type { ContentPart } from "../../domain/objects/message-content";
import { success, type Result } from "../../domain/objects/result";
import type { LlmError } from "../../domain/objects/errors";

export class PlaceholderLlmRepository implements LlmCompletionService {
  async complete(messages: ReadonlyArray<Message>): Promise<Result<LlmCompletionResult, LlmError>> {
    const latestMessage = messages.at(-1);

    if (!latestMessage) {
      return success({
        content: [
          {
            type: ContentPartType.Text,
            text: "No conversation context available.",
          },
        ],
        toolCalls: [],
      });
    }

    return success({
      content: latestMessage.content.map((part) => cloneContentPart(part)),
      toolCalls: [],
    });
  }
}

function cloneContentPart(messagePart: Message["content"][number]): ContentPart {
  if (messagePart.type === ContentPartType.Text) {
    return {
      type: ContentPartType.Text,
      text: messagePart.text,
    };
  }

  if (messagePart.type === ContentPartType.ImageUrl) {
    return {
      type: ContentPartType.ImageUrl,
      imageUrl: {
        url: messagePart.imageUrl.url,
      },
    };
  }

  if (messagePart.type === ContentPartType.File) {
    return {
      type: ContentPartType.File,
      fileId: messagePart.fileId,
    };
  }

  return {
    type: ContentPartType.Audio,
    data: messagePart.data,
  };
}
