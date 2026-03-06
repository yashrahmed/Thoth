import type { Message } from "@thoth/shared";

export class ConversationsAgent {
  async handle(message: Message): Promise<Message> {
    // TODO: implement LLM loop with Vercel AI SDK tool-use
    return {
      id: crypto.randomUUID(),
      content: "",
      timestamp: new Date(),
    };
  }
}
