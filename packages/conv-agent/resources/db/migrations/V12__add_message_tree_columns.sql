create extension if not exists ltree;

alter table thoth.messages
  add column if not exists parent_message_id text references thoth.messages (id),
  add column if not exists path ltree;
