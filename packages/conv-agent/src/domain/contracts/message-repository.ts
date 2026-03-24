import type { Message } from "../objects/message";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";
import type { LLMMessageType } from "../objects/llm";

export class CreateMessageRecord {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: string;
  readonly fileIds: ReadonlyArray<string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: {
    readonly conversationId: string;
    readonly type: LLMMessageType;
    readonly sequenceNumber: number;
    readonly content: string;
    readonly fileIds: ReadonlyArray<string>;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }) {
    this.conversationId = props.conversationId;
    this.type = props.type;
    this.sequenceNumber = props.sequenceNumber;
    this.content = props.content;
    this.fileIds = props.fileIds;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }
}

export interface MessagePageRequest {
  readonly conversationId: string;
  readonly pageNum: number;
  readonly pageSize: number;
}

export interface MessageSequencePageRequest {
  readonly conversationId: string;
  readonly fromSequence: number;
  readonly pageSize: number;
}

export interface MessageRepository {
  upsertMessageRow(record: CreateMessageRecord): Promise<Result<Message, StoreError>>;
  selectMessageRow(messageId: string): Promise<Result<Message, NotFoundError | StoreError>>;
  selectMessagePage(request: MessageSequencePageRequest): Promise<Result<Message[], StoreError>>;
  selectAllMessagesByConversation(conversationId: string): Promise<Result<Message[], StoreError>>;
  countMessagesByConversation(conversationId: string): Promise<Result<number, StoreError>>;
  deleteMessageRow(messageId: string): Promise<Result<void, StoreError>>;
  deleteMessagesByConversation(conversationId: string): Promise<Result<void, StoreError>>;
}
