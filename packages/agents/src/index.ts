import type { Message } from "@thoth/entities";
export * from "./conv-agent/controllers/conversation-controller";
export * from "./conv-agent/controllers/message-controller";
export * from "./planning-agent";
export * from "./repositories/conversation-repository";
export * from "./repositories/file-repository";
export * from "./repositories/message-repository";
export * from "./services/conversation-service";
export * from "./services/file-service";
export * from "./services/message-service";
export * from "./storage/r2-blob-storage";

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

export class PlanningAgent {
  async run(): Promise<void> {
    // TODO: expose planning workflows through the tool registry.
  }
}
