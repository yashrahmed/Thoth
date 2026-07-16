import { describe, expect, test } from "bun:test";

import { GeminiLlmAdapter } from "../adapter/llm/gemini-llm-adapter";
import { OpenAiLlmAdapter } from "../adapter/llm/openai-llm-adapter";
import type { LlmService } from "../domain/contracts/llm-service";
import { LLMMessageType, LlmModel, type LlmCompletionMessage } from "../domain/objects/llm";
import { Message } from "../domain/objects/message-types";
import { success } from "../domain/objects/result";
import type { FileAccessDomainService } from "../domain/services/file-access-domain-service";
import type { FileDomainService } from "../domain/services/file-domain-service";
import { LlmCompletionDomainService } from "../domain/services/llm-completion-domain-service";
import { LlmPromptDomainService } from "../domain/services/llm-prompt-domain-service";
import type { MessageDomainService } from "../domain/services/message-domain-service";
import { TimingToolsService } from "../domain/services/timing-tools-service";

const CONVERSATION_ID = "temporal-tools-system-test";
const FIXED_NOW = new Date("2026-07-11T13:02:05.000Z");
const EXPECTED_ELAPSED_SECONDS = 65;
interface ToolExecution {
  readonly name: string;
  readonly args: Readonly<Record<string, unknown>>;
}

const MESSAGES = [
  new Message(
    "101",
    CONVERSATION_ID,
    LLMMessageType.User,
    "This is the before turn for the temporal regression test.",
    new Date("2026-07-11T12:00:00.000Z"),
    new Date("2026-07-11T12:00:00.000Z"),
  ),
  new Message(
    "205",
    CONVERSATION_ID,
    LLMMessageType.Assistant,
    "This is the after turn for the temporal regression test.",
    new Date("2026-07-11T12:01:05.000Z"),
    new Date("2026-07-11T12:01:05.000Z"),
  ),
  new Message(
    "309",
    CONVERSATION_ID,
    LLMMessageType.User,
    ["Use get_elapsed_time to determine how many seconds elapsed between the first and second conversation turns.", "Reply only in the format ELAPSED_SECONDS=<integer>."].join(
      " ",
    ),
    new Date("2026-07-11T12:30:00.000Z"),
    new Date("2026-07-11T12:30:00.000Z"),
  ),
];

describe("temporal tool model-adapter system tests", () => {
  test("OpenAI GPT uses a temporal tool instead of message timestamp text", async () => {
    const timingTools = new TimingToolsService(() => FIXED_NOW);
    const result = await completeWithTrackedTimingTools(
      LlmModel.OpenAiGpt54,
      new OpenAiLlmAdapter({ apiKey: requireEnv("OPENAI_LLM_API_KEY") }, timingTools.get_description()),
      timingTools,
    );

    assertTemporalCompletion(result.messages, result.executions);
  });

  test("Gemini uses a temporal tool instead of message timestamp text", async () => {
    const timingTools = new TimingToolsService(() => FIXED_NOW);
    const result = await completeWithTrackedTimingTools(
      LlmModel.GoogleGemini3FlashPreview,
      new GeminiLlmAdapter({ apiKey: requireEnv("GOOGLE_LLM_API_KEY") }, timingTools.get_description()),
      timingTools,
    );

    assertTemporalCompletion(result.messages, result.executions);
  });
});

async function completeWithTrackedTimingTools(
  model: LlmModel,
  llmService: LlmService,
  timingToolsService: TimingToolsService,
): Promise<{ readonly messages: ReadonlyArray<LlmCompletionMessage>; readonly executions: ReadonlyArray<ToolExecution> }> {
  const executions: ToolExecution[] = [];
  const trackingTimingToolsService = stub<TimingToolsService>({
    run_tool: async (name, args, messageContext) => {
      executions.push({ name, args });
      return timingToolsService.run_tool(name, args, messageContext);
    },
  });
  const service = new LlmCompletionDomainService(
    stub<MessageDomainService>({
      findMessagesByIds: async () => success(MESSAGES),
    }),
    stub<FileDomainService>({
      getFilesOnMessages: async () => success([]),
    }),
    stub<FileAccessDomainService>({
      createSignedFileAccess: async () => success([]),
    }),
    {
      [LlmModel.OpenAiGpt54]: model === LlmModel.OpenAiGpt54 ? llmService : unusedLlmService(),
      [LlmModel.GoogleGemini3FlashPreview]: model === LlmModel.GoogleGemini3FlashPreview ? llmService : unusedLlmService(),
    },
    new LlmPromptDomainService(),
    trackingTimingToolsService,
  );
  const result = await service.complete({
    conversationId: CONVERSATION_ID,
    messageIds: MESSAGES.map((message) => message.id),
    model,
  });

  if (!result.ok) {
    throw new Error(`Temporal completion failed: ${JSON.stringify(result.error)}`);
  }

  return { messages: result.value, executions };
}

function unusedLlmService(): LlmService {
  return {
    llmComplete: async () => {
      throw new Error("The unselected LLM adapter should not be called.");
    },
  };
}

function assertTemporalCompletion(messages: ReadonlyArray<LlmCompletionMessage>, executions: ReadonlyArray<ToolExecution>): void {
  expect(executions).toContainEqual({
    name: "get_elapsed_time",
    args: { before_turn_number: 1, after_turn_number: 2 },
  });
  expect(messages).toHaveLength(1);
  expect(messages[0]?.type).toBe(LLMMessageType.Assistant);
  expect(messages[0]?.content).toContain(`ELAPSED_SECONDS=${EXPECTED_ELAPSED_SECONDS}`);
  expect(messages[0]?.content).not.toMatch(/sent at \d{4}-\d{2}-\d{2}/iu);
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function stub<T>(implementation: Partial<T>): T {
  return implementation as T;
}
