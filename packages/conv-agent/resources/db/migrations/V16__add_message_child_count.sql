alter table thoth.messages
  add column if not exists child_count integer not null default 0;

alter table thoth.messages
  drop constraint if exists messages_child_count_non_negative,
  add constraint messages_child_count_non_negative
    check (child_count >= 0) not valid;

alter table thoth.messages
  validate constraint messages_child_count_non_negative;
