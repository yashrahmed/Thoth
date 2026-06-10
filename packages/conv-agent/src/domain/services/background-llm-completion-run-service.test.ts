import { describe, expect, mock, test } from "bun:test";

import type { LlmService } from "../contracts/llm-service";
import { LLMMessageType, type LlmCompletionInputMessage, type LlmCompletionMessage, type LlmCompletionResult } from "../objects/llm";
import { LlmError, ValidationError } from "../objects/errors";
import { Message, type AppendMessageRecord } from "../objects/message-types";
import { failure, success, type Result } from "../objects/result";
import type { AppendUserMessageDomainService } from "./append-user-message-domain-service";
import { BackgroundLLMCompletionRunService } from "./background-llm-completion-run-service";
import type { FileAccessDomainService } from "./file-access-domain-service";
import type { FileDomainService } from "./file-domain-service";
import { LlmPromptDomainService } from "./llm-prompt-domain-service";
import type { MessageDomainService } from "./message-domain-service";

const CONVERSATION_ID = "conversation-1";
const PARENT_MESSAGE_ID = "message-3";
const APPEND_POSITION = 1;
const NOW = new Date("2026-06-04T01:30:00.000Z");
const ANCESTOR_CHAIN = [
  new Message("message-1", CONVERSATION_ID, LLMMessageType.User, "What cars were in the report?", NOW, NOW),
  new Message("message-2", CONVERSATION_ID, LLMMessageType.Assistant, "The report covered two cars.", NOW, NOW),
  new Message(PARENT_MESSAGE_ID, CONVERSATION_ID, LLMMessageType.User, "When was this report released?", NOW, NOW),
];

describe("BackgroundLLMCompletionRunService", () => {
  test("builds the prompt from the ancestor chain of the parent message", async () => {
    const harness = createHarness();

    harness.service.run({ conversationId: CONVERSATION_ID, parentMessageId: PARENT_MESSAGE_ID, appendPosition: APPEND_POSITION });
    await harness.waitForScheduledTasks();

    expect(harness.findAncestorChain).toHaveBeenCalledWith({ conversationId: CONVERSATION_ID, messageId: PARENT_MESSAGE_ID });

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

    harness.service.run({ conversationId: CONVERSATION_ID, parentMessageId: PARENT_MESSAGE_ID, appendPosition: APPEND_POSITION });
    await harness.waitForScheduledTasks();

    expect(harness.getFilesOnMessages).toHaveBeenCalledWith({ messageIds: ANCESTOR_CHAIN.map((message) => message.id) });
  });

  test("persists the completion at the requested append position under the parent message", async () => {
    const harness = createHarness();

    harness.service.run({ conversationId: CONVERSATION_ID, parentMessageId: PARENT_MESSAGE_ID, appendPosition: 4 });
    await harness.waitForScheduledTasks();

    expect(harness.persistMessages).toHaveBeenCalledTimes(1);
    expect(harness.persistInputs[0]).toMatchObject({
      parentMessageId: PARENT_MESSAGE_ID,
      appendPosition: 4,
    });
  });

  test("drops the completion without a fallback when the append position is occupied", async () => {
    const harness = createHarness({
      persistResult: failure(new ValidationError("appendPosition", "append position is already occupied.")),
    });

    harness.service.run({ conversationId: CONVERSATION_ID, parentMessageId: PARENT_MESSAGE_ID, appendPosition: APPEND_POSITION });
    await harness.waitForScheduledTasks();

    expect(harness.persistMessages).toHaveBeenCalledTimes(1);
  });

  test("persists a fallback assistant message at the requested position when the LLM fails", async () => {
    const harness = createHarness({
      llmResult: failure(new LlmError("provider timed out", "timeout")),
    });

    harness.service.run({ conversationId: CONVERSATION_ID, parentMessageId: PARENT_MESSAGE_ID, appendPosition: APPEND_POSITION });
    await harness.waitForScheduledTasks();

    expect(harness.persistMessages).toHaveBeenCalledTimes(1);
    expect(harness.persistInputs[0]).toMatchObject({
      parentMessageId: PARENT_MESSAGE_ID,
      appendPosition: APPEND_POSITION,
    });
    expect(harness.persistedMessages[0]).toMatchObject({ type: LLMMessageType.Assistant });
    expect(harness.persistedMessages[0]?.content).toContain("timed out");
  });

  test("strips copied Thoth timestamp metadata before persisting assistant completions", async () => {
    const harness = createHarness({
      completionContent: [
        "sent at 2026-06-04 01:21:51 +00:00 UTC",
        "",
        "Based on the document, the report was released in May 2026.",
        "sent at 2026-06-04 01:21:52 +00:00 UTC",
      ].join("\n"),
    });

    harness.service.run({ conversationId: CONVERSATION_ID, parentMessageId: PARENT_MESSAGE_ID, appendPosition: APPEND_POSITION });
    await harness.waitForScheduledTasks();

    expect(harness.persistMessages).toHaveBeenCalledTimes(1);
    expect(harness.persistedMessages).toHaveLength(1);
    expect(harness.persistedMessages[0]).toMatchObject({
      type: LLMMessageType.Assistant,
      content: "Based on the document, the report was released in May 2026.",
    });
  });

  test("does not persist an assistant completion that only contains copied timestamp metadata", async () => {
    const harness = createHarness({
      completionContent: "sent at 2026-06-04 01:21:51 +00:00 UTC",
    });

    harness.service.run({ conversationId: CONVERSATION_ID, parentMessageId: PARENT_MESSAGE_ID, appendPosition: APPEND_POSITION });
    await harness.waitForScheduledTasks();

    expect(harness.persistMessages).not.toHaveBeenCalled();
    expect(harness.persistedMessages).toHaveLength(0);
  });
});

interface PersistMessagesInput {
  readonly messages: ReadonlyArray<AppendMessageRecord>;
  readonly parentMessageId: string;
  readonly appendPosition?: number;
}

function createHarness(request?: {
  readonly completionContent?: string;
  readonly llmResult?: Result<LlmCompletionResult, LlmError>;
  readonly persistResult?: Result<Message[], ValidationError>;
}): {
  readonly service: BackgroundLLMCompletionRunService;
  readonly persistedMessages: AppendMessageRecord[];
  readonly persistInputs: PersistMessagesInput[];
  readonly llmInputs: ReadonlyArray<LlmCompletionInputMessage>[];
  readonly persistMessages: ReturnType<typeof mock>;
  readonly findAncestorChain: ReturnType<typeof mock>;
  readonly getFilesOnMessages: ReturnType<typeof mock>;
  readonly waitForScheduledTasks: () => Promise<void>;
} {
  const persistedMessages: AppendMessageRecord[] = [];
  const persistInputs: PersistMessagesInput[] = [];
  const llmInputs: ReadonlyArray<LlmCompletionInputMessage>[] = [];
  const scheduledTasks: Promise<unknown>[] = [];
  const completionMessages: LlmCompletionMessage[] = [
    {
      type: LLMMessageType.Assistant,
      content: request?.completionContent ?? "The report was released in May 2026.",
    },
  ];

  const persistMessages = mock((input: PersistMessagesInput) => {
    persistInputs.push(input);

    if (request?.persistResult && !request.persistResult.ok) {
      return Promise.resolve(request.persistResult);
    }

    persistedMessages.push(...input.messages);
    return Promise.resolve(success([]));
  });
  const findAncestorChain = mock(() => Promise.resolve(success(ANCESTOR_CHAIN)));
  const getFilesOnMessages = mock(() => Promise.resolve(success([])));

  const service = new BackgroundLLMCompletionRunService(
    stub<MessageDomainService>({
      findAncestorChain,
      buildNextMessageRecords: mock((input: { readonly conversationId: string; readonly messages: ReadonlyArray<Pick<AppendMessageRecord, "type" | "content">> }) =>
        success(
          input.messages.map((message) => ({
            conversationId: input.conversationId,
            type: message.type,
            content: message.content,
            createdAt: NOW,
            updatedAt: NOW,
          })),
        ),
      ),
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
    stub<AppendUserMessageDomainService>({
      persistMessages,
    }),
    new LlmPromptDomainService(),
    (task) => scheduledTasks.push(task),
  );

  return {
    service,
    persistedMessages,
    persistInputs,
    llmInputs,
    persistMessages,
    findAncestorChain,
    getFilesOnMessages,
    waitForScheduledTasks: () => Promise.all(scheduledTasks).then(() => undefined),
  };
}

function stub<T>(implementation: Partial<T>): T {
  return implementation as T;
}
