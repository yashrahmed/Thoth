-- flyway:executeInTransaction=false

create index concurrently if not exists messages_parent_idx
  on thoth.messages (conversation_id, parent_message_id);

create index concurrently if not exists messages_path_gist_idx
  on thoth.messages using gist (path);

create index concurrently if not exists messages_created_idx
  on thoth.messages (conversation_id, created_at, id);
