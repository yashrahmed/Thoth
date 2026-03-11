export type ConversationMessageRole =
  | "assistant"
  | "developer"
  | "system"
  | "user";

export interface AttachmentUpload {
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  body: ArrayBuffer;
}

export interface AttachmentDto {
  id: string;
  objectKey: string;
  originalFilename: string;
  mediaType: string;
  byteSize: number;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  role: ConversationMessageRole;
  textContent: string | null;
  attachments: AttachmentDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDto {
  id: string;
  messages: MessageDto[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationCommand {
  conversationId?: string;
}

export interface PostMessageCommand {
  conversationId: string;
  messageId?: string;
  role: ConversationMessageRole;
  textContent: string | null;
  attachments: AttachmentUpload[];
}

export interface DeleteConversationCommand {
  conversationId: string;
}

export interface DeleteMessageCommand {
  conversationId: string;
  messageId: string;
}

export interface ConversationsApplicationService {
  createConversation(input: CreateConversationCommand): Promise<ConversationDto>;
  getConversationById(conversationId: string): Promise<ConversationDto | null>;
  listConversations(): Promise<ConversationDto[]>;
  postMessage(input: PostMessageCommand): Promise<MessageDto>;
  deleteConversation(input: DeleteConversationCommand): Promise<void>;
  deleteMessage(input: DeleteMessageCommand): Promise<void>;
}
