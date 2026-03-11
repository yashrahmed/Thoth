import type { MessageType } from "@thoth/entities";

export interface LlmPromptMessage {
  role: MessageType;
  text: string;
}

export interface GenerateResponseInput {
  messages: LlmPromptMessage[];
}

export interface GenerateResponseOutput {
  message: LlmPromptMessage & {
    role: "assistant";
  };
}

export interface LlmServicePort {
  generateResponse(
    input: GenerateResponseInput,
  ): Promise<GenerateResponseOutput>;
}
