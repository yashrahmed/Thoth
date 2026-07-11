do $$
declare
  message_null_count bigint;
  message_duplicate_count bigint;
  file_missing_bigint_count bigint;
  file_mismatch_count bigint;
begin
  select count(*)
  into message_null_count
  from thoth.messages
  where id_bigint is null;

  select count(*)
  into message_duplicate_count
  from (
    select id_bigint
    from thoth.messages
    group by id_bigint
    having count(*) > 1
  ) as duplicates;

  select count(*)
  into file_missing_bigint_count
  from thoth.files
  where message_id is not null
    and message_id_bigint is null;

  select count(*)
  into file_mismatch_count
  from thoth.files as f
  left join thoth.messages as m
    on m.id = f.message_id
   and m.id_bigint = f.message_id_bigint
  where f.message_id is not null
    and m.id is null;

  if message_null_count > 0
    or message_duplicate_count > 0
    or file_missing_bigint_count > 0
    or file_mismatch_count > 0 then
    raise exception 'Cannot harden bigint message ids: message_nulls=%, message_duplicates=%, file_missing_bigints=%, file_mismatches=%',
      message_null_count,
      message_duplicate_count,
      file_missing_bigint_count,
      file_mismatch_count;
  end if;
end
$$;

alter table thoth.messages
  alter column id_bigint set not null;

alter table thoth.files
  add constraint files_message_id_bigint_fk
  foreign key (message_id_bigint)
  references thoth.messages (id_bigint)
  on delete cascade
  not valid;

alter table thoth.files
  validate constraint files_message_id_bigint_fk;

create table thoth.message_id_aliases (
  legacy_uuid text primary key,
  message_id bigint not null unique
    references thoth.messages (id_bigint)
    on delete cascade
);

insert into thoth.message_id_aliases (legacy_uuid, message_id)
select id, id_bigint
from thoth.messages;

-- Continue recording aliases for messages created by either old or
-- compatibility servers until the UUID column is removed.
create or replace function thoth.record_message_id_alias()
returns trigger
language plpgsql
set search_path = pg_catalog, thoth
as $$
begin
  insert into thoth.message_id_aliases (legacy_uuid, message_id)
  values (new.id, new.id_bigint)
  on conflict (legacy_uuid)
  do update set message_id = excluded.message_id;

  return new;
end
$$;

create trigger messages_record_id_alias
after insert or update of id, id_bigint
on thoth.messages
for each row
execute function thoth.record_message_id_alias();
