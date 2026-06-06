-- flyway:executeInTransaction=false

create unique index concurrently if not exists messages_path_unique
  on thoth.messages (conversation_id, path)
  where path is not null;
