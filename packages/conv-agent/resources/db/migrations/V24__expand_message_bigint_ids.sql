-- Keep the UUID primary key intact while every message begins receiving a
-- sequential bigint identifier. The nullable-first ordering lets existing
-- server versions continue inserting rows throughout the rollout.
alter table thoth.messages
  add column if not exists id_bigint bigint;

create sequence if not exists thoth.message_id_bigint_seq
  as bigint
  minvalue 1
  start with 1;

alter sequence thoth.message_id_bigint_seq
  owned by thoth.messages.id_bigint;

alter table thoth.messages
  alter column id_bigint
  set default nextval('thoth.message_id_bigint_seq');

alter table thoth.files
  add column if not exists message_id_bigint bigint;

-- Protect writes from both old UUID-only servers and compatibility servers.
-- A row may temporarily have only its UUID reference when it points at a
-- message that has not yet been backfilled; the file backfill fills it later.
create or replace function thoth.synchronize_file_message_ids()
returns trigger
language plpgsql
set search_path = pg_catalog, thoth
as $$
declare
  resolved_uuid text;
  resolved_bigint bigint;
begin
  if new.message_id is null and new.message_id_bigint is null then
    return new;
  end if;

  if new.message_id is not null and new.message_id_bigint is not null then
    perform 1
    from thoth.messages as m
    where m.id = new.message_id
      and m.id_bigint = new.message_id_bigint;

    if not found then
      raise exception 'File message identifiers do not resolve to the same message.'
        using errcode = '23503';
    end if;

    return new;
  end if;

  if new.message_id is not null then
    select m.id_bigint
    into resolved_bigint
    from thoth.messages as m
    where m.id = new.message_id;

    if not found then
      raise exception 'File UUID message identifier does not resolve to a message.'
        using errcode = '23503';
    end if;

    new.message_id_bigint := resolved_bigint;
    return new;
  end if;

  select m.id
  into resolved_uuid
  from thoth.messages as m
  where m.id_bigint = new.message_id_bigint;

  if not found then
    raise exception 'File bigint message identifier does not resolve to a message.'
      using errcode = '23503';
  end if;

  new.message_id := resolved_uuid;
  return new;
end
$$;

drop trigger if exists files_synchronize_message_ids on thoth.files;

create trigger files_synchronize_message_ids
before insert or update of message_id, message_id_bigint
on thoth.files
for each row
execute function thoth.synchronize_file_message_ids();
