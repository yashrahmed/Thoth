interface FileLike {
  id: string;
  object_key: string;
  original_filename: string;
  byte_size: number;
  last_create_ts: Date;
}

interface MessageLike {
  id: string;
  conversation_id: string;
  type: string;
  text_content: string | null;
  files: FileLike[];
  last_create_ts: Date;
  last_update_ts: Date;
}

interface ConversationLike {
  id: string;
  messages: MessageLike[];
  last_create_ts: Date;
  last_update_ts: Date;
}

function serializeFile(file: FileLike) {
  return {
    id: file.id,
    object_key: file.object_key,
    original_filename: file.original_filename,
    byte_size: file.byte_size,
    last_create_ts: file.last_create_ts.toISOString(),
  };
}

export function serializeMessage(message: MessageLike) {
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    type: message.type,
    text_content: message.text_content,
    files: message.files.map((file) => serializeFile(file)),
    last_create_ts: message.last_create_ts.toISOString(),
    last_update_ts: message.last_update_ts.toISOString(),
  };
}

export function serializeConversation(conversation: ConversationLike) {
  return {
    id: conversation.id,
    messages: conversation.messages.map((message) => serializeMessage(message)),
    last_create_ts: conversation.last_create_ts.toISOString(),
    last_update_ts: conversation.last_update_ts.toISOString(),
  };
}
