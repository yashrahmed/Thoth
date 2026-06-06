-- flyway:executeInTransaction=false

drop index concurrently if exists thoth.messages_conversation_sequence_idx;
