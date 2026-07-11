-- flyway:executeInTransaction=false

create unique index concurrently if not exists messages_id_bigint_unique_idx
  on thoth.messages (id_bigint);
