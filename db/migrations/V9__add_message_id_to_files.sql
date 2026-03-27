alter table thoth.files
  add column if not exists message_id text references thoth.messages (id) on delete cascade;

do $$
declare
  duplicate_file_reference_count integer;
begin
  select count(*)
  into duplicate_file_reference_count
  from (
    select file_id
    from thoth.messages as m
    cross join lateral unnest(m.file_ids) as file_id
    group by file_id
    having count(*) > 1
  ) as duplicate_file_references;

  if duplicate_file_reference_count > 0 then
    raise exception 'Cannot backfill thoth.files.message_id because some file ids are referenced by multiple messages.';
  end if;

  update thoth.files as f
  set message_id = message_file_links.message_id
  from (
    select
      m.id as message_id,
      file_id
    from thoth.messages as m
    cross join lateral unnest(m.file_ids) as file_id
  ) as message_file_links
  where
    f.id = message_file_links.file_id
    and f.message_id is null;
end
$$;

create index if not exists files_message_created_idx
  on thoth.files (message_id, created_at asc, id asc);
