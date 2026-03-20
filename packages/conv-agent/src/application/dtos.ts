import type { FileContent } from "../domain/objects/file-content";

export type MessageType = "user" | "assistant" | "system" | "tool";

export type ContentPartDto =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly imageUrl: { readonly url: string } }
  | { readonly type: "file"; readonly fileId: string }
  | { readonly type: "audio"; readonly data: string };

export interface ToolCallDto {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

export interface Attachment {
  readonly content: FileContent;
  readonly filename: string;
  readonly mimeType: string;
}

export interface AppendMessageRequest {
  readonly conversationId: string;
  readonly type: MessageType;
  readonly content: ReadonlyArray<ContentPartDto>;
  readonly toolCalls: ReadonlyArray<ToolCallDto>;
  readonly toolCallId: string;
  readonly attachments: ReadonlyArray<Attachment>;
}

export interface GetMessagesQuery {
  readonly conversationId: string;
  readonly pageNum: number;
  readonly pageSize: number;
}

export interface GetMessagesFile {
  readonly id: string;
  readonly canonicalUrl: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeInBytes: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GetMessagesItem {
  readonly id: string;
  readonly conversationId: string;
  readonly type: MessageType;
  readonly sequenceNumber: number;
  readonly content: ReadonlyArray<ContentPartDto>;
  readonly toolCalls: ReadonlyArray<ToolCallDto>;
  readonly toolCallId: string;
  readonly files: ReadonlyArray<GetMessagesFile>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ListConversationsQuery {
  readonly pageNum: number;
  readonly pageSize: number;
}

export interface ListConversationsItem {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreateConversationResult {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GetConversationQuery {
  readonly conversationId: string;
}

export interface GetConversationResult {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
