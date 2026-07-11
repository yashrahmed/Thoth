import { describe, expect, mock, test } from "bun:test";
import type { MessageRepository, ResolvedMessage } from "../contracts/message-repository";
import { LLMMessageType } from "../objects/llm";
import { Message } from "../objects/message-types";
import { success } from "../objects/result";
import { GenericValidationService } from "./generic-validation-service";
import { MessageDomainService } from "./message-domain-service";
import type { MessageContentDomainService } from "./message-content-domain-service";

const CONVERSATION_ID = "conversation-1";
const NOW = new Date("2026-07-10T12:00:00.000Z");
const MESSAGE_1 = new Message("1", CONVERSATION_ID, LLMMessageType.User, "First", NOW, NOW);
const MESSAGE_2 = new Message("2", CONVERSATION_ID, LLMMessageType.Assistant, "Second", NOW, NOW);

describe("MessageDomainService.findMessagesByIds", () => {
  test("preserves the explicit caller order returned by ID resolution", async () => {
    const resolved = [
      { requestedId: "2", message: MESSAGE_2 },
      { requestedId: "1", message: MESSAGE_1 },
    ];
    const { service, selectMessagesByIds } = createHarness(resolved);

    const result = await service.findMessagesByIds({
      conversationId: CONVERSATION_ID,
      messageIds: ["2", "1"],
    });

    expect(result).toEqual(success([MESSAGE_2, MESSAGE_1]));
    expect(selectMessagesByIds).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      messageIds: ["2", "1"],
    });
  });

  test("rejects a duplicate bigint ID", async () => {
    const { service } = createHarness([
      { requestedId: "1", message: MESSAGE_1 },
      { requestedId: "1", message: MESSAGE_1 },
    ]);

    const result = await service.findMessagesByIds({
      conversationId: CONVERSATION_ID,
      messageIds: ["1", "1"],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      kind: "ValidationError",
      fieldName: "messageIds",
    });
  });

  test("reports the original unresolved ID", async () => {
    const { service } = createHarness([{ requestedId: "1", message: MESSAGE_1 }]);

    const result = await service.findMessagesByIds({
      conversationId: CONVERSATION_ID,
      messageIds: ["1", "999"],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      kind: "NotFoundError",
      entityType: "Message",
      id: "999",
    });
  });
});

function createHarness(resolvedMessages: ReadonlyArray<ResolvedMessage>) {
  const selectMessagesByIds = mock(async () => success([...resolvedMessages]));
  const repository = { selectMessagesByIds } as unknown as MessageRepository;
  const service = new MessageDomainService(repository, {} as MessageContentDomainService, new GenericValidationService());

  return { service, selectMessagesByIds };
}
