import type { LLMMessageType } from "./llm";

export interface TextPart {
  readonly type: "text";
  readonly text: string;
}

export interface ImagePart {
  readonly type: "image";
  readonly fileId: string;
  readonly mediaType?: string;
}

export interface FilePart {
  readonly type: "file";
  readonly fileId: string;
  readonly mediaType?: string;
  readonly filename?: string;
}

export interface AudioPart {
  readonly type: "audio";
  readonly fileId: string;
  readonly mediaType?: string;
}

export interface ToolCallPart {
  readonly type: "tool-call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
}

export interface ToolResultPart {
  readonly type: "tool-result";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly output: unknown;
}

export type BlobPart = ImagePart | FilePart | AudioPart;
export type MessagePart = TextPart | ImagePart | FilePart | AudioPart | ToolCallPart | ToolResultPart;

export interface Message {
  readonly id: string;
  readonly conversationId: string;
  readonly type: LLMMessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<MessagePart>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
