import { describe, expect, mock, test } from "bun:test";

import type { LlmService } from "../contracts/llm-service";
import { LLMMessageType, type LlmCompletionInputMessage, type LlmCompletionMessage, type LlmCompletionResult } from "../objects/llm";
import { LlmError } from "../objects/errors";
import { Message } from "../objects/message-types";
import { failure, success, type Result } from "../objects/result";
import type { FileAccessDomainService } from "./file-access-domain-service";
import type { FileDomainService } from "./file-domain-service";
import { LlmCompletionDomainService } from "./llm-completion-domain-service";
import { LlmPromptDomainService } from "./llm-prompt-domain-service";
import type { MessageDomainService } from "./message-domain-service";

const CONVERSATION_ID = "conversation-1";
const MESSAGE_ID = "message-3";
const NOW = new Date("2026-06-04T01:30:00.000Z");
const ANCESTOR_CHAIN = [
  new Message("message-1", CONVERSATION_ID, LLMMessageType.User, "What cars were in the report?", NOW, NOW),
  new Message("message-2", CONVERSATION_ID, LLMMessageType.Assistant, "The report covered two cars.", NOW, NOW),
  new Message(MESSAGE_ID, CONVERSATION_ID, LLMMessageType.User, "When was this report released?", NOW, NOW),
];

describe("LlmCompletionDomainService", () => {
  test("builds the prompt from the ancestor chain of the target message", async () => {
    const harness = createHarness();

    await harness.service.complete({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID });

    expect(harness.findAncestorChain).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID });

    const llmInput = harness.llmInputs[0];

    expect(llmInput).toBeDefined();
    expect(llmInput).toHaveLength(ANCESTOR_CHAIN.length + 1);
    expect(llmInput?.[0]?.type).toBe(LLMMessageType.System);

    for (const [index, ancestor] of ANCESTOR_CHAIN.entries()) {
      expect(llmInput?.[index + 1]?.type).toBe(ancestor.type);
      expect(llmInput?.[index + 1]?.content).toContain(ancestor.content);
    }
  });

  test("requests files only for messages on the ancestor chain", async () => {
    const harness = createHarness();

    await harness.service.complete({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID });

    expect(harness.getFilesOnMessages).toHaveBeenCalledWith({ messageIds: ANCESTOR_CHAIN.map((message) => message.id) });
  });

  test("returns the completion messages without persisting anything", async () => {
    const harness = createHarness({ completionContent: "The report was released in May 2026." });

    const result = await harness.service.complete({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID });

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

    const result = await harness.service.complete({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toBeInstanceOf(LlmError);
    expect(result.ok ? null : (result.error as LlmError).code).toBe("timeout");
  });

  test("strips copied Thoth timestamp metadata from assistant completions", async () => {
    const harness = createHarness({
      completionContent: [
        "sent at 2026-06-04 01:21:51 +00:00 UTC",
        "",
        "Based on the document, the report was released in May 2026.",
        "sent at 2026-06-04 01:21:52 +00:00 UTC",
      ].join("\n"),
    });

    const result = await harness.service.complete({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : []).toEqual([
      {
        type: LLMMessageType.Assistant,
        content: "Based on the document, the report was released in May 2026.",
      },
    ]);
  });

  test("drops an assistant completion that only contains copied timestamp metadata", async () => {
    const harness = createHarness({
      completionContent: "sent at 2026-06-04 01:21:51 +00:00 UTC",
    });

    const result = await harness.service.complete({ conversationId: CONVERSATION_ID, messageId: MESSAGE_ID });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : null).toEqual([]);
  });
});

function createHarness(request?: { readonly completionContent?: string; readonly llmResult?: Result<LlmCompletionResult, LlmError> }): {
  readonly service: LlmCompletionDomainService;
  readonly llmInputs: ReadonlyArray<LlmCompletionInputMessage>[];
  readonly findAncestorChain: ReturnType<typeof mock>;
  readonly getFilesOnMessages: ReturnType<typeof mock>;
} {
  const llmInputs: ReadonlyArray<LlmCompletionInputMessage>[] = [];
  const completionMessages: LlmCompletionMessage[] = [
    {
      type: LLMMessageType.Assistant,
      content: request?.completionContent ?? "The report was released in May 2026.",
    },
  ];

  const findAncestorChain = mock(() => Promise.resolve(success(ANCESTOR_CHAIN)));
  const getFilesOnMessages = mock(() => Promise.resolve(success([])));

  const service = new LlmCompletionDomainService(
    stub<MessageDomainService>({
      findAncestorChain,
    }),
    stub<FileDomainService>({
      getFilesOnMessages,
    }),
    stub<FileAccessDomainService>({
      createSignedFileAccess: mock(() => Promise.resolve(success([]))),
    }),
    stub<LlmService>({
      llmComplete: mock((messages: ReadonlyArray<LlmCompletionInputMessage>): Promise<Result<LlmCompletionResult, LlmError>> => {
        llmInputs.push(messages);
        return Promise.resolve(request?.llmResult ?? success({ messages: completionMessages }));
      }),
    }),
    new LlmPromptDomainService(),
  );

  return {
    service,
    llmInputs,
    findAncestorChain,
    getFilesOnMessages,
  };
}

function stub<T>(implementation: Partial<T>): T {
  return implementation as T;
}
