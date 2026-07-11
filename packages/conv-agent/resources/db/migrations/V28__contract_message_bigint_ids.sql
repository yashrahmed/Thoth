set local lock_timeout = '5s';

do $$
declare
  message_null_count bigint;
  message_duplicate_count bigint;
  file_missing_bigint_count bigint;
  file_mismatch_count bigint;
  alias_missing_count bigint;
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

  select count(*)
  into alias_missing_count
  from thoth.messages as m
  left join thoth.message_id_aliases as a
    on a.legacy_uuid = m.id
   and a.message_id = m.id_bigint
  where a.legacy_uuid is null;

  if message_null_count > 0
    or message_duplicate_count > 0
    or file_missing_bigint_count > 0
    or file_mismatch_count > 0
    or alias_missing_count > 0 then
    raise exception 'Cannot contract bigint message ids: message_nulls=%, message_duplicates=%, file_missing_bigints=%, file_mismatches=%, alias_missing=%',
      message_null_count,
      message_duplicate_count,
      file_missing_bigint_count,
      file_mismatch_count,
      alias_missing_count;
  end if;
end
$$;

alter table thoth.messages
  add constraint messages_id_bigint_positive
  check (id_bigint > 0)
  not valid;

alter table thoth.messages
  validate constraint messages_id_bigint_positive;

drop trigger files_synchronize_message_ids on thoth.files;
drop function thoth.synchronize_file_message_ids();

drop trigger messages_record_id_alias on thoth.messages;
drop function thoth.record_message_id_alias();

alter table thoth.files
  drop constraint files_message_id_fkey;

drop index thoth.files_message_created_idx;

alter table thoth.files
  drop column message_id;

alter table thoth.messages
  alter column id drop default;

alter table thoth.messages
  drop constraint messages_pkey;

alter table thoth.messages
  add constraint messages_pkey
  primary key using index messages_id_bigint_unique_idx;

alter table thoth.messages
  drop column id;
