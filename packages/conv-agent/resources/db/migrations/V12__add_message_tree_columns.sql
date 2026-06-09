create extension if not exists ltree with schema thoth;

alter table thoth.messages
  add column if not exists parent_message_id text references thoth.messages (id),
  add column if not exists path thoth.ltree;
