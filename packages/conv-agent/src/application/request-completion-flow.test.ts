import { describe, expect, mock, test } from "bun:test";

import { Conversation } from "../domain/objects/conversation";
import { LlmModel } from "../domain/objects/llm";
import { success } from "../domain/objects/result";
import type { ConversationDomainService } from "../domain/services/conversation-domain-service";
import { GenericValidationService } from "../domain/services/generic-validation-service";
import type { LlmCompletionDomainService } from "../domain/services/llm-completion-domain-service";
import { RequestCompletionFlow } from "./request-completion-flow";

const CONVERSATION_ID = "conversation-1";
const MESSAGE_IDS = ["1", "2"];
const NOW = new Date("2026-07-16T12:00:00.000Z");

describe("RequestCompletionFlow", () => {
  test("passes a supported model to the completion service", async () => {
    const complete = mock(async () => success([]));
    const flow = createFlow(complete);

    const result = await flow.execute({
      conversationId: CONVERSATION_ID,
      messageIds: MESSAGE_IDS,
      model: ` ${LlmModel.OpenAiGpt54} `,
    });

    expect(result.ok).toBe(true);
    expect(complete).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      messageIds: MESSAGE_IDS,
      model: LlmModel.OpenAiGpt54,
    });
  });

  test("rejects an unsupported model before loading the conversation", async () => {
    const complete = mock(async () => success([]));
    const findById = mock(async () => success(new Conversation(CONVERSATION_ID, null, NOW, NOW)));
    const flow = createFlow(complete, findById);

    const result = await flow.execute({
      conversationId: CONVERSATION_ID,
      messageIds: MESSAGE_IDS,
      model: "unregistered-model",
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.error).toEqual({
      kind: "ValidationError",
      fieldName: "model",
      message: "model must be one of: gpt-5.4, gemini-3-flash-preview.",
    });
    expect(findById).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
});

function createFlow(complete: ReturnType<typeof mock>, findById = mock(async () => success(new Conversation(CONVERSATION_ID, null, NOW, NOW)))): RequestCompletionFlow {
  return new RequestCompletionFlow(stub<ConversationDomainService>({ findById }), new GenericValidationService(), stub<LlmCompletionDomainService>({ complete }));
}

function stub<T>(implementation: Partial<T>): T {
  return implementation as T;
}
