create extension if not exists pgcrypto;

alter table thoth.conversations
  alter column id set default gen_random_uuid()::text;
