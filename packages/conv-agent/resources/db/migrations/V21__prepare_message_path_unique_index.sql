-- flyway:executeInTransaction=false

create unique index concurrently if not exists messages_path_unique_idx
  on thoth.messages (conversation_id, path);

drop index concurrently if exists thoth.messages_path_unique;
