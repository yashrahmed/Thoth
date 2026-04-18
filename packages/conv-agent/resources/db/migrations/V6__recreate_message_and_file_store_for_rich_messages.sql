create extension if not exists pgcrypto;

drop table if exists thoth.message_files;
drop table if exists thoth.messages;
drop table if exists thoth.files;

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

create table thoth.messages (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null references thoth.conversations (id) on delete cascade,
  type text not null,
  sequence_number integer not null,
  content jsonb not null,
  tool_calls jsonb not null default '[]'::jsonb,
  tool_call_id text not null default '',
  file_ids text[] not null default '{}'::text[],
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint messages_type_valid check (type in ('user', 'assistant', 'system', 'tool')),
  constraint messages_sequence_number_positive check (sequence_number > 0),
  constraint messages_content_is_array check (jsonb_typeof(content) = 'array'),
  constraint messages_tool_calls_is_array check (jsonb_typeof(tool_calls) = 'array'),
  constraint messages_conversation_sequence_unique unique (conversation_id, sequence_number)
);

create index messages_conversation_sequence_idx
  on thoth.messages (conversation_id, sequence_number asc);
