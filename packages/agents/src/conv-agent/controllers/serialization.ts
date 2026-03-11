import type { Conversation, File, Message } from "@thoth/entities";

function serializeFile(file: File) {
  return {
    id: file.id,
    object_key: file.object_key,
    original_filename: file.original_filename,
    byte_size: file.byte_size,
    last_create_ts: file.last_create_ts.toISOString(),
  };
}

export function serializeMessage(message: Message) {
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

export function serializeConversation(conversation: Conversation) {
  return {
    id: conversation.id,
    messages: conversation.messages.map((message) => serializeMessage(message)),
    last_create_ts: conversation.last_create_ts.toISOString(),
    last_update_ts: conversation.last_update_ts.toISOString(),
  };
}
