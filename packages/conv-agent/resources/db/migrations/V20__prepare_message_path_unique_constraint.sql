alter table thoth.messages
  drop constraint if exists messages_path_unique;
