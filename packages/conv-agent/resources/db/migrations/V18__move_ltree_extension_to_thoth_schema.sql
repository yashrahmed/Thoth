create extension if not exists ltree with schema thoth;

do $$
declare
  ltree_schema text;
begin
  select n.nspname
  into ltree_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'ltree';

  if ltree_schema <> 'thoth' then
    raise exception 'ltree extension is installed in schema %, expected thoth. Undo and replay V12 so ltree is first created in thoth.', ltree_schema;
  end if;
end $$;
