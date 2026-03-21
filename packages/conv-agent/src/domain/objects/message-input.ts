import { ValidationError } from "./errors";
import { LLM_MESSAGE_TYPES, type LLMMessageType } from "./llm";
import { type MessagePart, validateMessageParts } from "./message-content";
import { failure, type Result } from "./result";
import { requireNonEmptyString, requirePositiveInteger } from "../validation";

export class CreateMessageInput {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<MessagePart>;

  constructor(props: {
    readonly conversationId: string;
    readonly type: LLMMessageType;
    readonly sequenceNumber: number;
    readonly content: ReadonlyArray<MessagePart>;
  }) {
    this.conversationId = props.conversationId;
    this.type = props.type;
    this.sequenceNumber = props.sequenceNumber;
    this.content = props.content;
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

export class CreateNextMessageInput {
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly content: ReadonlyArray<MessagePart>;

  constructor(props: {
    readonly conversationId: string;
    readonly type: LLMMessageType;
    readonly content: ReadonlyArray<MessagePart>;
  }) {
    this.conversationId = props.conversationId;
    this.type = props.type;
    this.content = props.content;
  }

  isValid(): Result<void, ValidationError> {
    const conversationIdResult = requireNonEmptyString(this.conversationId, "conversationId");

    if (!conversationIdResult.ok) {
      return conversationIdResult;
    }

    if (!LLM_MESSAGE_TYPES.includes(this.type)) {
      return failure(new ValidationError("type", "type must be one of user, assistant, system, or tool."));
    }

    return validateMessageParts(this.type, this.content);
  }
}
