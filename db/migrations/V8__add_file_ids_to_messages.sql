alter table thoth.messages
  add column if not exists file_ids text[] not null default '{}'::text[];

do $$
declare
  content_udt_name text;
begin
  select c.udt_name
  into content_udt_name
  from information_schema.columns as c
  where
    c.table_schema = 'thoth'
    and c.table_name = 'messages'
    and c.column_name = 'content';

  if content_udt_name = 'jsonb' then
    alter table thoth.messages
      drop constraint if exists messages_content_is_array;

    alter table thoth.messages
      add column content_text text not null default '';

    execute $sql$
      update thoth.messages
      set content_text = case
        when jsonb_typeof(content) = 'string' then content #>> '{}'
        when jsonb_typeof(content) = 'array' then coalesce(
          (
            select string_agg(coalesce(part ->> 'text', ''), E'\n\n' order by ordinality)
            from jsonb_array_elements(content) with ordinality as parts(part, ordinality)
            where coalesce(part ->> 'type', '') = 'text'
          ),
          ''
        )
        else content::text
      end
    $sql$;

    alter table thoth.messages
      drop column content;

    alter table thoth.messages
      rename column content_text to content;
  elsif content_udt_name = 'text' then
    null;
  else
    raise exception 'Unsupported thoth.messages.content type: %', content_udt_name;
  end if;
end
$$;
