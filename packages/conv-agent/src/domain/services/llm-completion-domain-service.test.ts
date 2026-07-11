import { describe, expect, mock, test } from "bun:test";

import type { LlmService } from "../contracts/llm-service";
import { LLMMessageType, type LlmCompletionInputMessage, type LlmCompletionMessage } from "../objects/llm";
import { LlmError } from "../objects/errors";
import { Message } from "../objects/message-types";
import { failure, success, type Result } from "../objects/result";
import type { FileAccessDomainService } from "./file-access-domain-service";
import type { FileDomainService } from "./file-domain-service";
import { LlmCompletionDomainService } from "./llm-completion-domain-service";
import { LlmPromptDomainService } from "./llm-prompt-domain-service";
import type { MessageDomainService } from "./message-domain-service";
import { TimingToolsService } from "./timing-tools-service";

const CONVERSATION_ID = "conversation-1";
const MESSAGE_ID = "message-3";
const NOW = new Date("2026-06-04T01:30:00.000Z");
const CONVERSATION_HISTORY = [
  new Message("message-1", CONVERSATION_ID, LLMMessageType.User, "What cars were in the report?", NOW, NOW),
  new Message("message-2", CONVERSATION_ID, LLMMessageType.Assistant, "The report covered two cars.", NOW, NOW),
  new Message(MESSAGE_ID, CONVERSATION_ID, LLMMessageType.User, "When was this report released?", NOW, NOW),
];
const MESSAGE_IDS = CONVERSATION_HISTORY.map((message) => message.id);

describe("LlmCompletionDomainService", () => {
  test("builds the prompt from the requested messages", async () => {
    const harness = createHarness();

    await harness.service.complete({ conversationId: CONVERSATION_ID, messageIds: MESSAGE_IDS });

    expect(harness.findMessagesByIds).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID, messageIds: MESSAGE_IDS });

    const llmInput = harness.llmInputs[0];

    if (!llmInput) {
      throw new Error("Expected an LLM input.");
    }

    expect(llmInput).toHaveLength(CONVERSATION_HISTORY.length + 1);
    expect(llmInput[0]?.type).toBe(LLMMessageType.System);

    for (const [index, historyMessage] of CONVERSATION_HISTORY.entries()) {
      expect(llmInput[index + 1]?.type).toBe(historyMessage.type);
      expect(llmInput[index + 1]?.content).toBe(historyMessage.content);
      expect(llmInput[index + 1]?.content).not.toContain("sent at");
    }
  });

  test("owns the tool loop and injects message context when resolving calls", async () => {
    const providerContext = { provider: "opaque-state" };
    const harness = createHarness({
      llmResults: [
        success({
          type: LLMMessageType.Assistant,
          content: "",
          toolCalls: [
            {
              id: "call-1",
              name: "get_elapsed_time",
              inputs: { before_turn_number: 1, after_turn_number: 2 },
            },
          ],
          providerContext,
        }),
        success({ type: LLMMessageType.Assistant, content: "65 seconds elapsed." }),
      ],
    });

    const result = await harness.service.complete({ conversationId: CONVERSATION_ID, messageIds: MESSAGE_IDS });

    expect(result).toEqual(success([{ type: LLMMessageType.Assistant, content: "65 seconds elapsed." }]));
    expect(harness.runTool).toHaveBeenCalledWith("get_elapsed_time", { before_turn_number: 1, after_turn_number: 2 }, CONVERSATION_HISTORY);
    expect(harness.llmInputs).toHaveLength(2);
    expect(harness.llmInputs[1]?.slice(-2)).toEqual([
      {
        type: LLMMessageType.Assistant,
        content: "",
        toolCalls: [
          {
            id: "call-1",
            name: "get_elapsed_time",
            inputs: { before_turn_number: 1, after_turn_number: 2 },
          },
        ],
        providerContext,
      },
      {
        type: LLMMessageType.Tool,
        content: expect.stringContaining('"elapsedSeconds":0'),
        toolCallId: "call-1",
        toolName: "get_elapsed_time",
      },
    ]);
  });

  test("fails completion when a requested tool cannot be resolved", async () => {
    const harness = createHarness({
      llmResult: success({
        type: LLMMessageType.Assistant,
        content: "",
        toolCalls: [{ id: "call-unknown", name: "unknown_tool", inputs: {} }],
      }),
    });

    const result = await harness.service.complete({ conversationId: CONVERSATION_ID, messageIds: MESSAGE_IDS });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toEqual(new LlmError("Timing tool cannot be resolved: unknown_tool."));
    expect(harness.llmInputs).toHaveLength(1);
  });

  test("requests files only for messages in the prompt history", async () => {
    const harness = createHarness();

    await harness.service.complete({ conversationId: CONVERSATION_ID, messageIds: MESSAGE_IDS });

    expect(harness.getFilesOnMessages).toHaveBeenCalledWith({ messageIds: CONVERSATION_HISTORY.map((message) => message.id) });
  });

  test("returns the completion messages without persisting anything", async () => {
    const harness = createHarness({ completionContent: "The report was released in May 2026." });

    const result = await harness.service.complete({ conversationId: CONVERSATION_ID, messageIds: MESSAGE_IDS });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : []).toEqual([
      {
        type: LLMMessageType.Assistant,
        content: "The report was released in May 2026.",
      },
    ]);
  });

  test("returns the LLM failure to the caller", async () => {
    const harness = createHarness({
      llmResult: failure(new LlmError("provider timed out", "timeout")),
    });

    const result = await harness.service.complete({ conversationId: CONVERSATION_ID, messageIds: MESSAGE_IDS });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toBeInstanceOf(LlmError);
    expect(result.ok ? null : (result.error as LlmError).code).toBe("timeout");
  });
});

function createHarness(request?: {
  readonly completionContent?: string;
  readonly llmResult?: Result<LlmCompletionMessage, LlmError>;
  readonly llmResults?: ReadonlyArray<Result<LlmCompletionMessage, LlmError>>;
}): {
  readonly service: LlmCompletionDomainService;
  readonly llmInputs: ReadonlyArray<LlmCompletionInputMessage | LlmCompletionMessage>[];
  readonly runTool: ReturnType<typeof mock>;
  readonly findMessagesByIds: ReturnType<typeof mock>;
  readonly getFilesOnMessages: ReturnType<typeof mock>;
} {
  const llmInputs: ReadonlyArray<LlmCompletionInputMessage | LlmCompletionMessage>[] = [];
  const completionMessage: LlmCompletionMessage = {
    type: LLMMessageType.Assistant,
    content: request?.completionContent ?? "The report was released in May 2026.",
  };
  const timingToolsService = new TimingToolsService(() => NOW);
  const runTool = mock((toolName: string, inputs: Readonly<Record<string, unknown>>, messageContext: ReadonlyArray<Message>) =>
    timingToolsService.run_tool(toolName, inputs, messageContext),
  );
  let llmCallIndex = 0;

  const findMessagesByIds = mock(() => Promise.resolve(success(CONVERSATION_HISTORY)));
  const getFilesOnMessages = mock(() => Promise.resolve(success([])));

  const service = new LlmCompletionDomainService(
    stub<MessageDomainService>({
      findMessagesByIds,
    }),
    stub<FileDomainService>({
      getFilesOnMessages,
    }),
    stub<FileAccessDomainService>({
      createSignedFileAccess: mock(() => Promise.resolve(success([]))),
    }),
    stub<LlmService>({
      llmComplete: mock((messages: ReadonlyArray<LlmCompletionInputMessage | LlmCompletionMessage>): Promise<Result<LlmCompletionMessage, LlmError>> => {
        llmInputs.push([...messages]);
        const result = request?.llmResults?.[llmCallIndex] ?? request?.llmResult ?? success(completionMessage);
        llmCallIndex += 1;
        return Promise.resolve(result);
      }),
    }),
    new LlmPromptDomainService(),
    stub<TimingToolsService>({ run_tool: runTool }),
  );

  return {
    service,
    llmInputs,
    runTool,
    findMessagesByIds,
    getFilesOnMessages,
  };
}

function stub<T>(implementation: Partial<T>): T {
  return implementation as T;
}
