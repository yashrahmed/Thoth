import { LLMMessageType, type LlmCompletionInputMessage } from "../objects/llm";
import type { Message } from "../objects/message-types";

const HEADER_TYPES: ReadonlySet<LLMMessageType> = new Set([LLMMessageType.User, LLMMessageType.Assistant]);

const SYSTEM_PROMPT = [
  "You are Thoth, a helpful conversational assistant.",
  "",
  "Each user turn is prefixed by the system with a metadata line of the form `sent at YYYY-MM-DD HH:MM:SS +00:00 UTC` followed by a blank line and then the user's content. This line is metadata used to give you temporal awareness; it is never something the user typed.",
  "",
  "Never reproduce that pattern in your own replies. Do not begin a reply with `sent at ...`, do not include such a line anywhere in your output, and do not echo or restate the metadata. If the user asks what time it is or when something was sent, answer in natural prose using the timestamps you have been given.",
].join("\n");

export class LlmPromptDomainService {
  buildSystemPrompt(): LlmCompletionInputMessage {
    return {
      type: LLMMessageType.System,
      content: SYSTEM_PROMPT,
      files: [],
    };
  }

  renderMessageContent(message: Message): string {
    if (!HEADER_TYPES.has(message.type)) {
      return message.content;
    }

    return `${formatSentAtHeader(message.createdAt)}\n\n${message.content}`;
  }
}

function formatSentAtHeader(createdAt: Date): string {
  const iso = createdAt.toISOString();
  return `sent at ${iso.slice(0, 10)} ${iso.slice(11, 19)} +00:00 UTC`;
}
