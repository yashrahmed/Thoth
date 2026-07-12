import { LLMMessageType, type LlmCompletionInputMessage } from "../objects/llm";
import type { Message } from "../objects/message-types";

const SYSTEM_PROMPT = [
  "You are Thoth, a helpful conversational assistant.",
  "",
  "Use get_current_time whenever the user asks about the current date or time. Use get_elapsed_time whenever the user asks for the elapsed time between two conversation turns. Turn numbers are 1-based positions in the supplied messages: turn 1 is the first message, turn 2 is the second, and so on. Never guess timestamps or perform date arithmetic yourself.",
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
    return message.content;
  }
}
