import type { Message } from "../objects/message";
import type { NotFoundError, StoreError } from "../objects/errors";
import type { Result } from "../objects/result";
import { LLM_MESSAGE_TYPES, type LLMMessageType } from "../objects/llm";
import { type MessagePart, validateMessageParts } from "../objects/message-content";
import { ValidationError } from "../objects/errors";
import { failure } from "../objects/result";
import { requireNonEmptyString, requirePositiveInteger } from "../validation";

export class CreateMessageRecord {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<MessagePart>;
  readonly createdAt: Date;
  readonly updatedAt: Date;

  constructor(props: {
    readonly conversationId: string;
    readonly type: LLMMessageType;
    readonly sequenceNumber: number;
    readonly content: ReadonlyArray<MessagePart>;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  }) {
    this.conversationId = props.conversationId;
    this.type = props.type;
    this.sequenceNumber = props.sequenceNumber;
    this.content = props.content;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
  }

  isValid(): Result<void, ValidationError> {
    const conversationIdResult = requireNonEmptyString(this.conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    const sequenceNumberResult = requirePositiveInteger(this.sequenceNumber, "sequenceNumber");

    if (!sequenceNumberResult.ok) {
      return sequenceNumberResult;
    }

    if (!LLM_MESSAGE_TYPES.includes(this.type)) {
      return failure(new ValidationError("type", "type must be one of user, assistant, system, or tool."));
    }

    return validateMessageParts(this.type, this.content);
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
}
