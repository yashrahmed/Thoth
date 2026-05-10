import { expect, test } from "bun:test";
import { LlmCompletionFlow } from "./llm-completion-flow";
import type { AppendUserMessageStore, PersistMessagesInput, PersistUserMessageWithFilesInput } from "../domain/contracts/append-user-message-store";
import type { BlobRepository } from "../domain/contracts/blob-repository";
import type { FileRepository } from "../domain/contracts/file-repository";
import type { FileSignedUrlGenerator } from "../domain/contracts/file-signed-url-generator";
import type { LlmCompletionService } from "../domain/contracts/llm-completion-service";
import type { MessageRepository } from "../domain/contracts/message-repository";
import { LLMMessageType, type LlmCompletionInputMessage, type LlmCompletionResult } from "../domain/objects/llm";
import { type AppendMessageRecord, File, Message } from "../domain/objects/message-types";
import { success, type Result } from "../domain/objects/result";
import type { LlmError, NotFoundError, StoreError, ValidationError } from "../domain/objects/errors";
import { BlobDomainService } from "../domain/services/blob-domain-service";
import { FileAccessDomainService } from "../domain/services/file-access-domain-service";
import { FileDomainService } from "../domain/services/file-domain-service";
import { GenericValidationService } from "../domain/services/generic-validation-service";
import { MessageContentDomainService } from "../domain/services/message-content-domain-service";
import { MessageDomainService } from "../domain/services/message-domain-service";
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
  const fileDomainService = new FileDomainService(new InMemoryFileRepository([]), new BlobDomainService(new NoopBlobRepository(), genericValidationService), genericValidationService);

  const flow = new LlmCompletionFlow(
    messageDomainService,
    fileDomainService,
    new FileAccessDomainService(new StaticFileSignedUrlGenerator()),
    llmCompletionService,
    new AppendUserMessageDomainService(appendStore),
  );

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

test("signs message files before calling the LLM completion service", async () => {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  const userMessage = new Message("message-1", "conversation-1", LLMMessageType.User, 1, "Summarize this file", createdAt, createdAt);
  const file = new File("file-1", userMessage.id, "/files/report.pdf", "report.pdf", "application/pdf", 1234, createdAt, createdAt);
  const messageRepository = new InMemoryMessageRepository([userMessage]);
  const appendStore = new CapturingAppendStore(messageRepository);
  const llmCompletionService = new StaticLlmCompletionService({ messages: [] });
  const fileSignedUrlGenerator = new StaticFileSignedUrlGenerator();
  const genericValidationService = new GenericValidationService();
  const messageDomainService = new MessageDomainService(messageRepository, new MessageContentDomainService(genericValidationService), genericValidationService, () => createdAt);
  const fileDomainService = new FileDomainService(new InMemoryFileRepository([file]), new BlobDomainService(new NoopBlobRepository(), genericValidationService), genericValidationService);

  const flow = new LlmCompletionFlow(
    messageDomainService,
    fileDomainService,
    new FileAccessDomainService(fileSignedUrlGenerator),
    llmCompletionService,
    new AppendUserMessageDomainService(appendStore),
  );

  const result = await flow.execute({ messageId: userMessage.id });

  expect(result.ok).toBe(true);
  expect(fileSignedUrlGenerator.signedFileIds).toEqual(["file-1"]);
  expect(llmCompletionService.receivedMessages).toEqual([
    [
      {
        type: LLMMessageType.User,
        content: "Summarize this file",
        createdAt,
        files: [
          {
            filename: "report.pdf",
            mimeType: "application/pdf",
            signedUrl: "https://signed.example/file-1",
          },
        ],
      },
    ],
  ]);
});

class StaticLlmCompletionService implements LlmCompletionService {
  readonly receivedMessages: ReadonlyArray<LlmCompletionInputMessage>[] = [];

  constructor(private readonly result: LlmCompletionResult) {}

  async llmComplete(messages: ReadonlyArray<LlmCompletionInputMessage>): Promise<Result<LlmCompletionResult, LlmError>> {
    this.receivedMessages.push(messages);
    return success(this.result);
  }
}

class StaticFileSignedUrlGenerator implements FileSignedUrlGenerator {
  readonly signedFileIds: string[] = [];

  async createSignedUrl(file: File): Promise<Result<string, StoreError>> {
    this.signedFileIds.push(file.id);
    return success(`https://signed.example/${file.id}`);
  }
}

class NoopBlobRepository implements BlobRepository {
  async putBlob(): Promise<Result<string, StoreError>> {
    throw new Error("Unexpected blob put.");
  }

  async removeBlob(): Promise<Result<void, StoreError>> {
    throw new Error("Unexpected blob remove.");
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

class InMemoryFileRepository implements FileRepository {
  constructor(private readonly files: ReadonlyArray<File>) {}

  async upsertFileRow(): Promise<Result<File, StoreError>> {
    throw new Error("Unexpected file upsert.");
  }

  async selectFileRow(): Promise<Result<File, NotFoundError | StoreError>> {
    throw new Error("Unexpected file select.");
  }

  async selectFileRows(ids: ReadonlyArray<string>): Promise<Result<File[], StoreError>> {
    return success(this.files.filter((file) => ids.includes(file.id)));
  }

  async selectFileRowsByMessageIds(messageIds: ReadonlyArray<string>): Promise<Result<File[], StoreError>> {
    return success(this.files.filter((file) => messageIds.includes(file.messageId)));
  }

  async deleteFileRow(): Promise<Result<void, StoreError>> {
    throw new Error("Unexpected file delete.");
  }

  async deleteFileRows(): Promise<Result<void, StoreError>> {
    throw new Error("Unexpected files delete.");
  }

  async deleteFileRowsByMessageIds(): Promise<Result<void, StoreError>> {
    throw new Error("Unexpected files by message delete.");
  }
}
