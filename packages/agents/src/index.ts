import type { Message } from "@thoth/entities";
export * from "./conv-agent/controllers/conversation-controller";
export * from "./conv-agent/controllers/message-controller";
export * from "./conv-agent/controllers/test-response-controller";
export * from "./conv-agent/app";
export * from "./planning-agent";
export * from "./repositories/conversation-repository";
export * from "./repositories/message-repository";
export * from "./services/generate-response-service";
export * from "./services/openai-llm-service";

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
