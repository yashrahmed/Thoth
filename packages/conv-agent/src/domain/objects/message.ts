import { ConstructionError } from "./errors";
import { ContentPartType } from "./content-part-type";
import { LLM_MESSAGE_TYPES, LLMMessageType } from "./llm";
import type { ContentPart, ToolCall } from "./message-content";

interface MessageProps {
  readonly id: string;
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<ContentPart>;
  readonly toolCalls: ReadonlyArray<ToolCall>;
  readonly toolCallId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly fileIds: ReadonlyArray<string>;
}

export class Message {
  readonly id: string;
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<ContentPart>;
  readonly toolCalls: ReadonlyArray<ToolCall>;
  readonly toolCallId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly fileIds: ReadonlyArray<string>;

  constructor(props: MessageProps) {
    if (props.id.trim().length === 0) {
      throw new ConstructionError("Message", "Message id must be a non-empty string.");
    }

    if (props.conversationId.trim().length === 0) {
      throw new ConstructionError("Message", "Message conversationId must be a non-empty string.");
    }

    if (!LLM_MESSAGE_TYPES.includes(props.type)) {
      throw new ConstructionError("Message", "Message type must be one of user, assistant, system, or tool.");
    }

    if (!Number.isInteger(props.sequenceNumber) || props.sequenceNumber <= 0) {
      throw new ConstructionError("Message", "Message sequenceNumber must be a positive integer.");
    }

    validateContent(props.content);
    validateToolCalls(props.toolCalls);

    if (typeof props.toolCallId !== "string") {
      throw new ConstructionError("Message", "Message toolCallId must be a string.");
    }

    if (Number.isNaN(props.createdAt.getTime())) {
      throw new ConstructionError("Message", "Message createdAt must be a valid date.");
    }

    if (Number.isNaN(props.updatedAt.getTime())) {
      throw new ConstructionError("Message", "Message updatedAt must be a valid date.");
    }

    for (const fileId of props.fileIds) {
      if (fileId.trim().length === 0) {
        throw new ConstructionError("Message", "Message fileIds must contain only non-empty strings.");
      }
    }

    this.id = props.id;
    this.conversationId = props.conversationId;
    this.type = props.type;
    this.sequenceNumber = props.sequenceNumber;
    this.content = props.content;
    this.toolCalls = props.toolCalls;
    this.toolCallId = props.toolCallId;
    this.createdAt = props.createdAt;
    this.updatedAt = props.updatedAt;
    this.fileIds = props.fileIds;
  }
}

function validateContent(content: ReadonlyArray<ContentPart>): void {
  if (!Array.isArray(content)) {
    throw new ConstructionError("Message", "Message content must be an array.");
  }

  for (const part of content) {
    if (part.type === ContentPartType.Text) {
      if (part.text.trim().length === 0) {
        throw new ConstructionError("Message", "Message text content must be a non-empty string.");
      }

      continue;
    }

    if (part.type === ContentPartType.ImageUrl) {
      if (part.imageUrl.url.trim().length === 0) {
        throw new ConstructionError("Message", "Message image_url content must include a non-empty url.");
      }

      continue;
    }

    if (part.type === ContentPartType.File) {
      if (part.fileId.trim().length === 0) {
        throw new ConstructionError("Message", "Message file content must include a non-empty fileId.");
      }

      continue;
    }

    if (part.type === ContentPartType.Audio) {
      if (part.data.trim().length === 0) {
        throw new ConstructionError("Message", "Message audio content must include non-empty data.");
      }

      continue;
    }

    throw new ConstructionError("Message", "Message content type must be text, image_url, file, or audio.");
  }
}

function validateToolCalls(toolCalls: ReadonlyArray<ToolCall>): void {
  if (!Array.isArray(toolCalls)) {
    throw new ConstructionError("Message", "Message toolCalls must be an array.");
  }

  for (const toolCall of toolCalls) {
    if (toolCall.id.trim().length === 0) {
      throw new ConstructionError("Message", "Message toolCalls must contain non-empty ids.");
    }

    if (toolCall.name.trim().length === 0) {
      throw new ConstructionError("Message", "Message toolCalls must contain non-empty names.");
    }

    if (typeof toolCall.args !== "object" || toolCall.args === null || Array.isArray(toolCall.args)) {
      throw new ConstructionError("Message", "Message toolCalls must contain object args.");
    }
  }
}
