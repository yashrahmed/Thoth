drop table if exists thoth.messages;

create table thoth.messages (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null references thoth.conversations (id) on delete cascade,
  type text not null,
  sequence_number integer not null,
  content jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint messages_type_valid check (type in ('user', 'assistant', 'system', 'tool')),
  constraint messages_sequence_number_positive check (sequence_number > 0),
  constraint messages_content_is_array check (jsonb_typeof(content) = 'array'),
  constraint messages_conversation_sequence_unique unique (conversation_id, sequence_number)
);

create index messages_conversation_sequence_idx
  on thoth.messages (conversation_id, sequence_number asc);
