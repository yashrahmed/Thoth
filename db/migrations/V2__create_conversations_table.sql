create table if not exists thoth.conversations (
  id text primary key,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists conversations_updated_at_id_idx
  on thoth.conversations (updated_at desc, id desc);
