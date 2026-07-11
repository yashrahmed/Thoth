-- flyway:executeInTransaction=false

create index concurrently if not exists files_message_bigint_created_idx
  on thoth.files (message_id_bigint, created_at asc, id asc);
