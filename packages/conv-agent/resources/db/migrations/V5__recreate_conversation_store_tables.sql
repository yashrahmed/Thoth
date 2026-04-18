create extension if not exists pgcrypto;

drop table if exists thoth.message_file_references;
drop table if exists thoth.message_files;
drop table if exists thoth.messages;
drop table if exists thoth.files;
drop table if exists thoth.conversations;

create table thoth.conversations (
  id text primary key default gen_random_uuid()::text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index conversations_updated_at_id_idx
  on thoth.conversations (updated_at desc, id desc);

create table thoth.messages (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null references thoth.conversations (id) on delete cascade,
  sequence_number integer not null,
  text_content text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint messages_sequence_number_positive check (sequence_number > 0),
  constraint messages_conversation_sequence_unique unique (conversation_id, sequence_number)
);

create index messages_conversation_sequence_idx
  on thoth.messages (conversation_id, sequence_number asc);

create table thoth.files (
  id text primary key default gen_random_uuid()::text,
  canonical_url text not null,
  filename text not null,
  mime_type text not null,
  size_in_bytes integer not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint files_size_in_bytes_non_negative check (size_in_bytes >= 0)
);

create table thoth.message_files (
  message_id text not null references thoth.messages (id) on delete cascade,
  file_id text not null references thoth.files (id) on delete cascade,
  attachment_position integer not null,
  primary key (message_id, file_id),
  constraint message_files_attachment_position_positive check (attachment_position > 0),
  constraint message_files_message_position_unique unique (message_id, attachment_position)
);

create index message_files_message_position_idx
  on thoth.message_files (message_id, attachment_position asc);

create index message_files_file_id_idx
  on thoth.message_files (file_id);
