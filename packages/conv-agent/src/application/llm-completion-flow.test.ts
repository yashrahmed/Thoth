import { expect, test } from "bun:test";
import { LlmCompletionFlow } from "./llm-completion-flow";
import type { AppendUserMessageStore, PersistMessagesInput, PersistUserMessageWithFilesInput } from "../domain/contracts/append-user-message-store";
import type { LlmCompletionService } from "../domain/contracts/llm-completion-service";
import type { MessageRepository } from "../domain/contracts/message-repository";
import { LLMMessageType, type LlmCompletionResult } from "../domain/objects/llm";
import { type AppendMessageRecord, Message } from "../domain/objects/message-types";
import { success, type Result } from "../domain/objects/result";
import type { LlmError, NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import { GenericValidationService } from "../domain/services/generic-validation-service";
import { MessageContentDomainService } from "../domain/services/message-content-domain-service";
import { MessageDomainService } from "../domain/services/message-domain-service";
import { LlmDomainService } from "../domain/services/llm-domain-service";
import { AppendUserMessageDomainService } from "../domain/services/append-user-message-domain-service";

test("appends every message returned by the LLM completion in order", async () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const userMessage = new Message("message-1", "conversation-1", LLMMessageType.User, 1, "Use a tool", createdAt, createdAt);
  const messageRepository = new InMemoryMessageRepository([userMessage]);
  const appendStore = new CapturingAppendStore(messageRepository);
  const llmCompletionService = new StaticLlmCompletionService({
    messages: [
      { type: LLMMessageType.Assistant, content: "I will call a tool." },
      { type: LLMMessageType.Tool, content: "Tool result." },
      { type: LLMMessageType.Assistant, content: "Done." },
    ],
  });

  const genericValidationService = new GenericValidationService();
  const messageDomainService = new MessageDomainService(messageRepository, new MessageContentDomainService(genericValidationService), genericValidationService, () => createdAt);

  const flow = new LlmCompletionFlow(messageDomainService, new LlmDomainService(llmCompletionService), new AppendUserMessageDomainService(appendStore));

  const result = await flow.execute({ messageId: userMessage.id });

  expect(result.ok).toBe(true);
  expect(appendStore.persistedRecords).toEqual([
    {
      conversationId: "conversation-1",
      type: LLMMessageType.Assistant,
      content: "I will call a tool.",
      createdAt,
      updatedAt: createdAt,
    },
    {
      conversationId: "conversation-1",
      type: LLMMessageType.Tool,
      content: "Tool result.",
      createdAt,
      updatedAt: createdAt,
    },
    {
      conversationId: "conversation-1",
      type: LLMMessageType.Assistant,
      content: "Done.",
      createdAt,
      updatedAt: createdAt,
    },
  ]);
  expect(messageRepository.messages.map((message) => message.sequenceNumber)).toEqual([1, 2, 3, 4]);
});

class StaticLlmCompletionService implements LlmCompletionService {
  constructor(private readonly result: LlmCompletionResult) {}

  async llmComplete(_messages: ReadonlyArray<Message>): Promise<Result<LlmCompletionResult, LlmError>> {
    return success(this.result);
  }
}

class CapturingAppendStore implements AppendUserMessageStore {
  readonly persistedRecords: AppendMessageRecord[] = [];

  constructor(private readonly messageRepository: InMemoryMessageRepository) {}

  async persistUserMessageWithFiles(input: PersistUserMessageWithFilesInput): Promise<Result<Message, ValidationError | StoreError>> {
    return this.persistOne(input.message);
  }

  async persistMessages(input: PersistMessagesInput): Promise<Result<Message[], ValidationError | StoreError>> {
    const messages: Message[] = [];

    for (const message of input.messages) {
      const persistResult = await this.persistOne(message);

      if (!persistResult.ok) {
        return persistResult;
      }

      messages.push(persistResult.value);
    }

    return success(messages);
  }

  private async persistOne(record: AppendMessageRecord): Promise<Result<Message, ValidationError | StoreError>> {
    this.persistedRecords.push(record);
    const latestSequenceNumber = this.messageRepository.messages
      .filter((message) => message.conversationId === record.conversationId)
      .reduce((highest, message) => Math.max(highest, message.sequenceNumber), 0);
    const sequenceNumber = latestSequenceNumber + 1;
    const message = new Message(`message-${sequenceNumber}`, record.conversationId, record.type, sequenceNumber, record.content, record.createdAt, record.updatedAt);
    this.messageRepository.messages.push(message);
    return success(message);
  }
}

class InMemoryMessageRepository implements MessageRepository {
  readonly messages: Message[];

  constructor(messages: Message[]) {
    this.messages = [...messages];
  }

  async selectMessageRow(messageId: string): Promise<Result<Message, NotFoundError | StoreError>> {
    const message = this.messages.find((item) => item.id === messageId);

    if (!message) {
      throw new Error(`Unexpected missing message ${messageId}.`);
    }

    return success(message);
  }

  async selectMessagePage(): Promise<Result<Message[], StoreError>> {
    return success(this.messages);
  }

  async selectAllMessagesByConversation(conversationId: string): Promise<Result<Message[], StoreError>> {
    return success(this.messages.filter((message) => message.conversationId === conversationId).sort((a, b) => a.sequenceNumber - b.sequenceNumber));
  }

  async deleteMessageRow(): Promise<Result<void, StoreError>> {
    return success(undefined);
  }

  async deleteMessagesByConversation(): Promise<Result<void, StoreError>> {
    return success(undefined);
  }
}
