alter table thoth.messages
  drop constraint if exists messages_sequence_number_positive,
  drop constraint if exists messages_conversation_sequence_unique;
