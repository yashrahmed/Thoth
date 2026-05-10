import { LLMMessageType, type LlmCompletionInputMessage } from "../../domain/objects/llm";

const HEADER_TYPES: ReadonlySet<LLMMessageType> = new Set([LLMMessageType.User, LLMMessageType.Assistant]);

export function formatSentAtHeader(createdAt: Date): string {
  const iso = createdAt.toISOString();
  return `sent at ${iso.slice(0, 10)} ${iso.slice(11, 19)} +00:00 UTC`;
}

export function shouldRenderHeader(type: LLMMessageType): boolean {
  return HEADER_TYPES.has(type);
}

export function withSentAtHeader(message: Pick<LlmCompletionInputMessage, "type" | "content" | "createdAt">): string {
  if (!shouldRenderHeader(message.type)) {
    return message.content;
  }

  return `${formatSentAtHeader(message.createdAt)}\n\n${message.content}`;
}
