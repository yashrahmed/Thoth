import { describe, expect, mock, test } from "bun:test";

import type { LlmService } from "../contracts/llm-service";
import { LLMMessageType, type LlmCompletionInputMessage, type LlmCompletionResult } from "../objects/llm";
import { Message, type AppendMessageRecord } from "../objects/message-types";
import { success, type Result } from "../objects/result";
import type { AppendUserMessageDomainService } from "./append-user-message-domain-service";
import { BackgroundLLMCompletionRunService } from "./background-llm-completion-run-service";
import type { FileAccessDomainService } from "./file-access-domain-service";
import type { FileDomainService } from "./file-domain-service";
import { LlmPromptDomainService } from "./llm-prompt-domain-service";
import type { MessageDomainService } from "./message-domain-service";

const CONVERSATION_ID = "conversation-1";
const USER_MESSAGE_ID = "message-1";
const NOW = new Date("2026-06-04T01:30:00.000Z");
const USER_MESSAGE = new Message(USER_MESSAGE_ID, CONVERSATION_ID, LLMMessageType.User, "When was this report released?", NOW, NOW);

describe("BackgroundLLMCompletionRunService", () => {
  test("strips copied Thoth timestamp metadata before persisting assistant completions", async () => {
    const harness = createHarness({
      completionContent: [
        "sent at 2026-06-04 01:21:51 +00:00 UTC",
        "",
        "Based on the document, the report was released in May 2026.",
        "sent at 2026-06-04 01:21:52 +00:00 UTC",
      ].join("\n"),
    });

    harness.service.run({ conversationId: CONVERSATION_ID, messageId: USER_MESSAGE_ID, parentMessageId: USER_MESSAGE_ID });
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

    harness.service.run({ conversationId: CONVERSATION_ID, messageId: USER_MESSAGE_ID, parentMessageId: USER_MESSAGE_ID });
    await harness.waitForScheduledTasks();

    expect(harness.persistMessages).not.toHaveBeenCalled();
    expect(harness.persistedMessages).toHaveLength(0);
  });
});

function createHarness(request: { readonly completionContent: string }): {
  readonly service: BackgroundLLMCompletionRunService;
  readonly persistedMessages: AppendMessageRecord[];
  readonly persistMessages: ReturnType<typeof mock>;
  readonly waitForScheduledTasks: () => Promise<void>;
} {
  const persistedMessages: AppendMessageRecord[] = [];
  const scheduledTasks: Promise<unknown>[] = [];
  const persistMessages = mock((input: { readonly messages: ReadonlyArray<AppendMessageRecord>; readonly parentMessageId: string }) => {
    expect(input.parentMessageId).toBe(USER_MESSAGE_ID);
    persistedMessages.push(...input.messages);
    return Promise.resolve(success([]));
  });

  const service = new BackgroundLLMCompletionRunService(
    stub<MessageDomainService>({
      findByIdInConversation: mock(() => Promise.resolve(success(USER_MESSAGE))),
      findAll: mock(() => Promise.resolve(success([USER_MESSAGE]))),
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
      getFilesByConversation: mock(() => Promise.resolve(success([]))),
    }),
    stub<FileAccessDomainService>({
      createSignedFileAccess: mock(() => Promise.resolve(success([]))),
    }),
    stub<LlmService>({
      llmComplete: mock(
        (_messages: ReadonlyArray<LlmCompletionInputMessage>): Promise<Result<LlmCompletionResult, never>> =>
          Promise.resolve(
            success({
              messages: [
                {
                  type: LLMMessageType.Assistant,
                  content: request.completionContent,
                },
              ],
            }),
          ),
      ),
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
    persistMessages,
    waitForScheduledTasks: () => Promise.all(scheduledTasks).then(() => undefined),
  };
}

function stub<T>(implementation: Partial<T>): T {
  return implementation as T;
}
