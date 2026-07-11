import { describe, expect, mock, test } from "bun:test";
import type { MessageRepository, ResolvedMessage } from "../contracts/message-repository";
import { LLMMessageType } from "../objects/llm";
import { Message } from "../objects/message-types";
import { success } from "../objects/result";
import { GenericValidationService } from "./generic-validation-service";
import { MessageDomainService } from "./message-domain-service";
import type { MessageContentDomainService } from "./message-content-domain-service";

const CONVERSATION_ID = "conversation-1";
const LEGACY_ID_1 = "4f3de38e-3226-40f2-a7d8-958cc82a4c55";
const LEGACY_ID_2 = "29e5f4cd-bd97-45d8-b122-08e1a4874348";
const NOW = new Date("2026-07-10T12:00:00.000Z");
const MESSAGE_1 = new Message("1", CONVERSATION_ID, LLMMessageType.User, "First", NOW, NOW);
const MESSAGE_2 = new Message("2", CONVERSATION_ID, LLMMessageType.Assistant, "Second", NOW, NOW);

describe("MessageDomainService.findMessagesByIds", () => {
  test("preserves the explicit caller order returned by ID resolution", async () => {
    const resolved = [
      { requestedId: LEGACY_ID_2, message: MESSAGE_2 },
      { requestedId: "1", message: MESSAGE_1 },
    ];
    const { service, selectMessagesByIds } = createHarness(resolved);

    const result = await service.findMessagesByIds({
      conversationId: CONVERSATION_ID,
      messageIds: [LEGACY_ID_2, "1"],
    });

    expect(result).toEqual(success([MESSAGE_2, MESSAGE_1]));
    expect(selectMessagesByIds).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      messageIds: [LEGACY_ID_2, "1"],
    });
  });

  test("rejects UUID and bigint aliases that resolve to the same message", async () => {
    const { service } = createHarness([
      { requestedId: LEGACY_ID_1, message: MESSAGE_1 },
      { requestedId: "1", message: MESSAGE_1 },
    ]);

    const result = await service.findMessagesByIds({
      conversationId: CONVERSATION_ID,
      messageIds: [LEGACY_ID_1, "1"],
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
      messageIds: ["1", LEGACY_ID_2],
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error).toMatchObject({
      kind: "NotFoundError",
      entityType: "Message",
      id: LEGACY_ID_2,
    });
  });
});

function createHarness(resolvedMessages: ReadonlyArray<ResolvedMessage>) {
  const selectMessagesByIds = mock(async () => success([...resolvedMessages]));
  const repository = { selectMessagesByIds } as unknown as MessageRepository;
  const service = new MessageDomainService(repository, {} as MessageContentDomainService, new GenericValidationService());

  return { service, selectMessagesByIds };
}
