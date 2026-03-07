import type { Message } from "@thoth/entities";

export class ConversationsAgent {
  async handle(message: Message): Promise<Message> {
    // TODO: implement the LLM loop and tool registry.
    return {
      ...message,
      id: crypto.randomUUID(),
      last_create_ts: new Date(),
      last_update_ts: new Date(),
    };
  }
}

export class KnowledgeCurationAgent {
  async run(): Promise<void> {
    // TODO: read from the conversations store and update curated knowledge.
  }
}
