export type ConversationId = string;
export type FileId = string;
export type MessageId = string;

// Markdown source is the canonical message text format.
export type MarkdownTextContent = string;

// Aligned with the current OpenAI conversation message roles.
export type MessageType = "assistant" | "developer" | "system" | "user";

export interface File {
  id: FileId;
  object_key: string;
  original_filename: string;
  byte_size: number;
  last_create_ts: Date;
}

export interface Message {
  id: MessageId;
  conversation_id: ConversationId;
  type: MessageType;
  text_content: MarkdownTextContent | null;
  files: File[];
  last_create_ts: Date;
  last_update_ts: Date;
}

export interface Conversation {
  id: ConversationId;
  messages: Message[];
  last_create_ts: Date;
  last_update_ts: Date;
}
